#!/usr/local/bin/node
/**
 * annote
 *
 * Auto-generated documentation in the form of annotated source code.
 */

//
// ### Required dependencies
// * **filesystem** utilities
// * **path** utilities
// * **async** for simplifying asyncronous coding
// * **nconf** for reading command line params and configuration
// * **highlight** for syntax highlighting
// * **marked** for parsing markdown in comments
// * **plates** for templating
var fs = require('fs'),
	path = require('path'),
	async = require('async'),
	nconf = require('nconf'),
	highlight = require('highlight').Highlight,
	markdown = require('marked'),
	Plates = require('plates');

//
// ### Command line options
// Descriptions of options are in the source code... Examples of calls:
//
// ```
//     annote.js --path lib --match "*.js" --write-to documentation // document js files from lib in the documentation directory
//     annote.js --path src -d 1 // only document code at the root of the src directory
//     annote.js -p src --maxdepth 1 // same as previous
//     annote.js --no-markdown // no markdown in comments
//     annote.js --md --no-highlight // markdown but no syntax highlighting
// ```
nconf.argv({
		config: { alias: 'c', string: true, describe: 'Optionally provide a path to a json config file.' },
		path: { alias: 'p', string: true, describe: 'Generate docs for files found at this path.' },
		match: { alias: 'm', string: true, describe: 'Annotate files matching this name pattern. (e.g. *.js, or *.{js,php})' },
		maxdepth: { alias: 'd', demand: true, describe: 'Recurse only this deep to find source code.' },
		"write-to": { alias: 'w', string: true, describe: 'Write the documentation here.' },
		markdown: { alias: 'md', boolean: true, default: true, describe: 'Assume markdown in annotations?' },
		highlight: { alias: 'h', boolean: true, default: true, describe: 'Use syntax highlighting in source code?' },
		verbose: { alias: 'v', boolean: true, describe: 'Provide lots of details?' },
		layout: { alias: 'l', string: true, describe: 'Use this html file for the layout of the documentation pages.' },
		block: { alias: 'b', string: true, describe: 'Use this partial html file for generating snippets of annotated code.' }
	})


// TODO: Add a config file into the mix if they asked for it on the command line
// if(nconf.get('config')) nconf.file(nconf.get('config'));


// Set up the default configuration
nconf.defaults({
		path: ".",
		match: "*.js",
		maxdepth: null,
		"write-to": "docs",
		// markdown: true,
		// highlight: true,
		layout: "layout.html",
		block: "block.html"
	});


// For convenience we alias the configuration values we are using
var PATH = nconf.get('path'),
	MATCH = nconf.get('match'),
	MAXDEPTH = nconf.get('maxdepth'),
	WRITE_TO = nconf.get('write-to'),
	MARKDOWN = nconf.get('markdown'),
	HIGHLIGHT = nconf.get('highlight'),
	LAYOUT = nconf.get('layout'),
	BLOCK = nconf.get('block'),
	VERBOSE = nconf.get('verbose');


//
// ### Function: log
// `console.log` only if they set the verbose flag
function log() {
	if(VERBOSE) console.log.apply(console, arguments);
}

//
// ### Initialize templates
// Read in the raw template files and set up the map object that tells
// Plates how to map our data object into the markup.
var tplLayout = fs.readFileSync(LAYOUT, 'utf8'),
	tplBlock = fs.readFileSync(BLOCK, 'utf8'),
	map = Plates.Map();
map.class('annotation').to('comment');
map.class('annotated-code').to('code');


//
// ###Find the files
// We find the files using a 'find' command on the OS... Assuming a *nix system here.
var findCmd = 'find ' + PATH + (MAXDEPTH ? ' -maxdepth ' + MAXDEPTH : '') + ' -type f -name "' + MATCH + '" -print';
require('child_process').exec(findCmd, function(err, stdout, stderr) {
	if(err) throw err;

	// Now that we have the files we can iterate over them
	async.forEach(stdout.split('\n'), function(file, cb) {
		if(!file) return cb();

		// Generate the path where we will create the documentation file
		file = path.normalize(file);
		var fileOut = path.join(WRITE_TO, file.replace(/\.js$/, '.js.html'));

		console.log('Annotating: ' + file + ' -> ' + fileOut);

		// Read the source file, pass the contents to annotateCode, take the resulting markup and, after
		// ensuring that the directory exists, write the markup to file.
		async.waterfall([
			async.apply(readFile, file),
			async.apply(annotateCode, file),
			function(markup, cb) {
				async.series([
					async.apply(ensureDirectoryExists, path.dirname(fileOut)),
					async.apply(writeFile, fileOut, markup)
				], cb);
			}
		], cb);
	}, function(err) {
		if(err) throw new Error(err);
	})
});

//
// ### Function: readFile
// A function for asyncronously reading a file
function readFile(file, cb) {
	log('Reading: ' + file);
	fs.readFile(file, 'utf8', cb);
}

//
// ### Function: writeFile
// A function for asyncronously writing a file
function writeFile(file, contents, cb) {
	log('Writing: ' + file + ' (' + contents.length + ' chars)');
	fs.writeFile(file, contents, cb);
}

//
// ### Function: ensureDirectoryExists
// A function to asyncronously ensure that a directory exists, recursively creating it if it does not
function ensureDirectoryExists(dir, cb) {
	log('Checking for dir: ' + dir);
	path.exists(dir, function(exists) {
		if(exists) return cb();

		ensureDirectoryExists(path.dirname(dir), function(err) {
			if(err) return cb(err);

			log('Making directory: ' + dir);
			fs.mkdir(dir, cb);
		});
	});
}

//
// ### Regular expressions for parsing source code
// * **rxStartAnnotation** Identify start of annotation (empty comment line)
// * **rxComment** Used to identify comment lines and remove whitespace and slashes from the start of the line
// * **rxBlankLine** Use to identify blank lines
var rxStartAnnotation = /^\s*\/\/\s*$/,
	rxComment = /^\s*\/\/\s*/,
	rxBlankLine = /^\s*$/;

//
// ### Function: annotateCode
// A function to parse an individual source file and return markup representing annotated documentation
function annotateCode(file, code, cb) {
	var lines = code.split('\n'),
		line,
		block = { comment:[], code:[] },
		blocks = [ block ],
		inAnnotation = true;

	log('Parsing: ' + file);

	// Loop over the lines of the file and build a collection of comment/code pairs
	for(var i = 0, len = lines.length; i < len; i++) {
		line = lines[i];
		if(!inAnnotation && rxStartAnnotation.test(line)) {
			blocks.push(block = { comment:[], code:[] });
			inAnnotation = true;
		} else if(inAnnotation && rxComment.test(line)) {
			block.comment.push(line.replace(rxComment, ''));
		} else {
			if(inAnnotation && rxBlankLine.test(line)) continue;
			inAnnotation = false;
			block.code.push(line)
		}
	}

	// Parse the markdown for each comment and perform syntax highlighting for each code block
	blocks.forEach(function(block) {
		block.comment = MARKDOWN ? markdown(block.comment.join('\n')) : block.comment.join('\n');
		block.code = '<pre><code>' + (HIGHLIGHT ? highlight(block.code.join('\n')) : block.code.join('\n')) + '</code></pre>';
	});

	// Generate the markup using Plates templates
	var markup = Plates.bind(tplLayout, {
		title: file + ' - annote',
		file: file,
		'annotated-source': Plates.bind(tplBlock, blocks, map)
	});
	log('Parsed: ' + file + ' (' + markup.length + ' chars)');
	cb(null, markup);
}
