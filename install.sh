#!/bin/bash
# Mushaf-Warsh Extension Installer for macOS
# Run with: sudo bash install.sh

echo "=========================================="
echo "Mushaf-Warsh Ornament Replacer Installer"
echo "=========================================="
echo ""

# Check for sudo
if [ "$EUID" -ne 0 ]; then 
    echo "ERROR: Please run this script with sudo!"
    echo "Usage: sudo bash install.sh"
    exit 1
fi

# Set extension folder
EXT_FOLDER="/Library/Application Support/Adobe/CEP/extensions/com.mushafwarsh.ornamentReplacer"

echo "Creating extension folder..."
mkdir -p "$EXT_FOLDER"

echo "Copying extension files..."
cp -R "$(dirname "$0")/"* "$EXT_FOLDER/"

echo "Enabling debug mode for CEP..."
defaults write com.adobe.CSXS.7 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.8 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.9 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null

echo ""
echo "=========================================="
echo "Installation Complete!"
echo "=========================================="
echo ""
echo "Please restart Adobe Illustrator"
echo "Then go to: Window > Extensions > Mushaf-Warsh Ornament Replacer"
echo ""
