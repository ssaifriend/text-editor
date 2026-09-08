export const defaultFileText = `{
  // moru settings (JSONC: comments and trailing commas are allowed)
  "editor": {
    "fontFamily": ["D2Coding", "Sarasa Mono K", "ui-monospace", "Menlo", "Consolas", "monospace"],
    "fontSize": 13,
    "tabSize": 4,
    "insertSpaces": true,
    "wordWrap": false,
    // "keep-all" keeps Korean words unbroken at line ends
    "wordBreak": "normal",
    "rulers": [],
    "highlightWhitespace": false,
    "lineNumbers": true
  },
  "files": {
    "autoSave": "off",
    "hotExit": true,
    "trimTrailingWhitespace": false,
    "insertFinalNewline": false,
    "defaultEncoding": "utf8",
    "defaultEol": "auto"
  },
  "theme": "moru-dark",
  // per-language overrides use the language id as the key
  "languages": {
    "markdown": { "wordWrap": true }
  },
  "log": { "level": "info" }
}
`
