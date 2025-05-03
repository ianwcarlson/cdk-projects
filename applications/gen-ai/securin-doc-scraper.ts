import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

function extractTextFromHtmlFiles(rootPath: string, outputPath: string): void {
  // Recursively process files and directories
  function processDirectory(currentPath: string, relativePath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Create corresponding directory in output path
        const outputDir = path.join(outputPath, entryRelativePath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        processDirectory(entryPath, entryRelativePath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        // Read and parse HTML file
        const htmlContent = fs.readFileSync(entryPath, 'utf-8');
        const $ = cheerio.load(htmlContent);
        const body = $('body');
        // Remove script and style tags
        body.find('script, style, table, tb, tr').remove();
        const textContent = body.text().trim();
        // Remove extra whitespace
        const cleanedTextContent = textContent.replace(/\s+/g, ' ');
        // Remove non-ascii characters
        const cleanedTextContentWithoutNonAscii = cleanedTextContent.replace(/[^\x20-\x7E]/g, '');
        // Remove " l " at the beginning of sentences
        // This regex removes " l " at the beginning of sentences, but not if it's part of a word
        const cleanedTextContentWithoutL = cleanedTextContentWithoutNonAscii.replace(/^\s*l\s+/g, '');
        // Remove newlines if there are more than 2 consecutive newlines
        const cleanedTextContentWithNewlines = cleanedTextContentWithoutL.replace(/(\n\s*){2,}/g, '\n\n');
        // Remove any style related content
        const cleanedTextContentWithoutStyle = cleanedTextContentWithNewlines.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        // Remove any font-face related content
        const cleanedTextContentWithoutFontFace = cleanedTextContentWithoutStyle.replace(/@font-face[^}]*}/g, '');

        // Write text content to output path
        const outputFilePath = path.join(outputPath, entryRelativePath.replace(/\.html$/, '.txt'));
        fs.writeFileSync(outputFilePath, cleanedTextContentWithoutFontFace, 'utf-8');
      }
    }
  }

  processDirectory(rootPath, '');
}

function removeAllFilesAndFolders(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function cleanDirectories(rootPath: string): void {
  function processDirectory(currentPath: string): boolean {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    let containsTxtFile = false;

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        const subDirContainsTxtFile = processDirectory(entryPath);
        if (!subDirContainsTxtFile) {
          fs.rmdirSync(entryPath, { recursive: true });
        } else {
          containsTxtFile = true;
        }
      } else if (entry.isFile() && entry.name.endsWith('.txt')) {
        containsTxtFile = true;
      }
    }

    return containsTxtFile;
  }

  processDirectory(rootPath);
}

// Example usage
const rootPath = path.resolve(__dirname, "..", "..", "..", "..", 'Downloads', 'platform-documentation');
const outputPath = path.resolve(__dirname, "..", "..", "..", "..", 'Downloads', 'platform-documentation-output');
removeAllFilesAndFolders(outputPath);
extractTextFromHtmlFiles(rootPath, outputPath);
cleanDirectories(outputPath);