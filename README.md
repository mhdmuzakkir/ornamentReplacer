# Mushaf-Warsh Ornament Replacer - Illustrator Extension

A comprehensive Adobe Illustrator CEP (Common Extensibility Platform) extension for the Mushaf-Warsh project. This extension automates the replacement of Quranic ornament objects (Ayah, Ruba, Sajdah, Hizb, HizbX, Surah, and Border) in Adobe Illustrator documents.

## Features

### Template Management
- **Browse & Select Templates**: Choose any `.ai` template file containing ornament designs
- **Save Template Preferences**: Save frequently used templates with name and location
- **Quick Template Switching**: Load saved templates with one click
- **Template Exclusion**: Automatically excludes template file from batch processing

### Designs Panel
- **Visual Design Preview**: See all linked designs from the template
- **Design Status Indicators**: Shows which ornament types are available in the template
- **Real-time Refresh**: Update design list when template changes

### Processing Modes
- **Single File Mode**: Process the currently active document
- **Batch Mode**: Process entire folders of `.ai` files

### Ornament Types Supported
| Type | Arabic Name | Size (mm) | Script |
|------|-------------|-----------|--------|
| Ayah | آية | 4-5 × 5-7 | ayah.jsx |
| Sajdah | سجدة | 12-15 × 21-22 | sajdah.jsx |
| Ruba | ربع | 12-15 × 25-26 | ruba.jsx |
| Hizb | حزب | 12-15 × 38-40 | hizb.jsx |
| HizbX | حزبx | 12-15 × 41-45 | hizbx.jsx |
| Surah | سورة | 87-88 × 9-10 | surah.jsx |
| Border | إطار | 102-104 × 157-159 | border.jsx |

### Options
- **Silent Mode**: Run without alert dialogs for automated workflows
- **Fit Artboard**: Execute Ctrl+0 (Fit in Window) before processing
- **Auto-save**: Automatically save documents after processing
- **Selective Processing**: Choose which ornament types to process

## Installation

### Method 1: Manual Installation

1. **Locate Extensions Folder**:
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `/Library/Application Support/Adobe/CEP/extensions/`

2. **Create Extension Folder**:
   ```
   mkdir -p "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.mushafwarsh.ornamentReplacer"
   ```

3. **Copy Files**:
   Copy all extension files to the created folder.

4. **Enable Debug Mode** (for unsigned extensions):
   
   **Windows Registry**:
   ```
   Windows Registry Editor Version 5.00
   
   [HKEY_CURRENT_USER\Software\Adobe\CSXS.7]
   "PlayerDebugMode"="1"
   
   [HKEY_CURRENT_USER\Software\Adobe\CSXS.8]
   "PlayerDebugMode"="1"
   
   [HKEY_CURRENT_USER\Software\Adobe\CSXS.9]
   "PlayerDebugMode"="1"
   
   [HKEY_CURRENT_USER\Software\Adobe\CSXS.10]
   "PlayerDebugMode"="1"
   
   [HKEY_CURRENT_USER\Software\Adobe\CSXS.11]
   "PlayerDebugMode"="1"
   ```
   
   **macOS Terminal**:
   ```bash
   defaults write com.adobe.CSXS.7 PlayerDebugMode 1
   defaults write com.adobe.CSXS.8 PlayerDebugMode 1
   defaults write com.adobe.CSXS.9 PlayerDebugMode 1
   defaults write com.adobe.CSXS.10 PlayerDebugMode 1
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```

### Method 2: ZXP Installation (Recommended for Distribution)

1. **Package as ZXP**:
   Use Adobe's `ZXPSignCmd` tool to sign the extension:
   ```bash
   ZXPSignCmd -sign MushafWarshExtension MushafWarshExtension.zxp cert.p12 password
   ```

2. **Install with ZXP Installer**:
   - Use [Anastasiy's Extension Manager](https://anastasiy.com/extensionmanager)
   - Or [ZXP Installer from aescripts](https://aescripts.com/learn/zxp-installer/)

## Usage

### 1. Select Template
1. Click **"Browse Template"** to select your `.ai` template file
2. The template should contain named page items: `ayah`, `sajdah`, `ruba`, `hizb`, `hizbx`, `surah`, `border`
3. Click **Save Template** to add it to your saved templates list

### 2. View Linked Designs
- The **Linked Designs** section shows which ornament types are available in your template
- Green indicator = Design found
- Red indicator = Design not found

### 3. Choose Processing Mode
- **Single File**: Process the currently open document
- **Batch**: Process all `.ai` files in a selected folder

### 4. Configure Options
- **Silent Mode**: Suppress alert dialogs
- **Fit Artboard**: Auto-fit view before processing
- **Auto-save**: Save documents automatically

### 5. Select Ornament Types
- Check/uncheck ornament types to process
- Click **"Select All"** to toggle all types

### 6. Process
- Click **"Scan Document"** to preview what will be replaced
- Click **"Process"** to execute the replacement

## Template File Structure

Your template `.ai` file should have page items named exactly as follows:

```
- ayah      (Ayah marker)
- sajdah    (Sajdah marker)
- ruba      (Ruba marker)
- hizb      (Hizb marker)
- hizbx     (HizbX marker)
- surah     (Surah header)
- border    (Page border)
```

## File Structure

```
MushafWarshExtension/
├── CSXS/
│   └── manifest.xml          # Extension manifest
├── jsx/
│   ├── host.jsx              # Main host script
│   ├── ayah.jsx              # Ayah replacement
│   ├── sajdah.jsx            # Sajdah replacement
│   ├── ruba.jsx              # Ruba replacement
│   ├── hizb.jsx              # Hizb replacement
│   ├── hizbx.jsx             # HizbX replacement
│   ├── surah.jsx             # Surah replacement
│   └── border.jsx            # Border replacement
├── lib/
│   ├── CSInterface.js        # Adobe CEP interface
│   ├── main.js               # Panel JavaScript
│   └── styles.css            # Panel styles
├── assets/
│   └── icon.svg              # Extension icon
├── index.html                # Main panel HTML
├── .debug                    # Debug configuration
└── README.md                 # This file
```

## Compatibility

- **Adobe Illustrator**: CC 2018 (v22) and later
- **CEP Version**: 7.0 and later
- **Operating Systems**: Windows 10/11, macOS 10.14+

## Troubleshooting

### Extension Not Showing in Illustrator
1. Verify extension is in correct folder
2. Enable PlayerDebugMode in registry/preferences
3. Restart Illustrator
4. Check Window > Extensions menu

### "Template Not Found" Error
- Verify template file path is correct
- Ensure template file exists and is accessible
- Try reselecting the template

### Designs Not Found in Template
- Verify page items in template are named correctly (lowercase)
- Check that template file is not corrupted
- Refresh designs list after selecting template

### Batch Processing Errors
- Check batch_log.txt in the processed folder
- Ensure all files are valid .ai files
- Verify template file is excluded from processing folder

## Development

### Debug Mode
The `.debug` file enables debugging on port 8088. Use Chrome DevTools:
1. Open Chrome and navigate to `http://localhost:8088`
2. Select the extension context
3. Debug JavaScript and inspect DOM

### Logging
Extension logs are saved to:
- Windows: `%APPDATA%\MushafWarsh\log.txt`
- macOS: `~/Library/Application Support/MushafWarsh/log.txt`

## License

This extension is part of the Mushaf-Warsh project.

## Support

For issues and feature requests, please contact the Mushaf-Warsh development team.
