'use strict';

var fs = require('fs');
var cheerio = require('cheerio');
var path = require('path');
var mkdirp = require('mkdirp');

module.exports = function remapCobertura (opts) {
    if (!opts.bundlePath ||
        !opts.inputCoberturaPath ||
        !opts.outputCoberturaPath ||
        !opts.outputJsDir) {
        throw new Error('Missing option');
    }

    var files = processBundleAndCoberturaFiles(opts.bundlePath, opts.outputJsDir);
    generateRemappedCoberturaFile(opts.inputCoberturaPath, opts.outputCoberturaPath, files);
    writeExplodedJsFiles(files);
};

function processBundleAndCoberturaFiles (bundlePath, outputJsDir) {
    var bundleJsFile = fs.readFileSync(bundlePath).toString();
    var currentFile = null;
    var currentLineNumber = 1;
    var currentFileLineNumber = 1;
    var cwd = process.cwd();
    var files = [];
    files.byLineNumber = {};
    
    bundleJsFile.split('\n').forEach(function (line) {
        var str = null;
        var fileName = null;
        var $class = null;
        var jsFileName = null;
        
        if (line.match(/^},{(.*)function\(require,module,exports\){$/)) {
            str = line.substring(0, line.length - 36);
            fileName = str.substr(str.lastIndexOf('"') + 1);
            if (fileName.match(/\.d\.ts$/)) {
                currentFile = null;
            } else {
                currentFileLineNumber = 1;
                jsFileName = outputJsDir + fileName.substring(cwd.length + 1).replace('ts', 'js');
                $class = cheerio.load('<class><methods></methods><lines></lines></class>').root().find('class');
                $class.attr('name', path.basename(jsFileName));
                $class.attr('filename', jsFileName);
                $class.attr('line-rate', '1');
                $class.attr('branch-rate', '1');
                currentFile = {
                    name: fileName,
                    jsFileName: jsFileName,
                    $class: $class,
                    content: ''
                };
                files.push(currentFile);
            }
        } else if (currentFile) {
            files.byLineNumber[currentLineNumber] = {
                file: currentFile,
                lineNumber: currentFileLineNumber
            };
            currentFileLineNumber++;
            currentFile.content += line;
            currentFile.content += '\n';
        }
        currentLineNumber++;
    });
    return files;
}

function generateRemappedCoberturaFile (inputCoberturaPath, outputCoberturaPath, files) {
    var coverageFile = fs.readFileSync(inputCoberturaPath);
    var $ = cheerio.load(coverageFile);
    var $class = $('class');
    var $methods = $('methods > method');
    var $lines = $('classes > class > lines > line');

    $methods.each(function (index, method) {
        var $method = $(method);
        var originalNumber = $method.children('lines').children('line').attr('number');
        if (files.byLineNumber[originalNumber]) {
            $method.children('lines').children('line').attr('number', files.byLineNumber[originalNumber].lineNumber);
            files.byLineNumber[originalNumber].file.$class.find('methods').append($method);
        }
    });

    $lines.each(function (index, line) {
        var $line = $(line);
        var originalNumber = $line.attr('number');
        if (files.byLineNumber[originalNumber]) {
            $line.attr('number', files.byLineNumber[originalNumber].lineNumber);
            files.byLineNumber[originalNumber].file.$class.find('lines').append($line);
        }
    });

    $class.remove();
    
    $('classes').append(files.map(function (file) {
        return file.$class
    }));

    fs.writeFileSync(outputCoberturaPath, $.xml());
}

function writeExplodedJsFiles (files) {
    files.forEach(function (file) {
        mkdirp.sync(path.dirname(file.jsFileName));
        fs.writeFileSync(file.jsFileName, file.content);
    });
}
