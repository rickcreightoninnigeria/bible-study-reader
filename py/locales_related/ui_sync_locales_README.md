# UI Locale Sync Tool (`ui_sync_locales.py`)

This script automates the tedious task of keeping multiple translation files in sync with your primary English file (`ui_en.json`).

## Core Features
*   **Automatic Injection**: Scans `ui_en.json` and adds any newly created keys to all other language files with a `[TODO]` prefix.
*   **Section Preservation**: Respects your "dummy headers" (e.g., `___section: app-init.js`) to keep the JSON organized logically as the project grows.
*   **Ghost Key Cleanup**: Automatically removes "Orphaned" keys from translation files if they have been deleted from the English source.
*   **Change Reporting**: Generates a `sync_report.txt` file detailing exactly which keys were added or removed for every language.

## How to Use
1. Update your `ui_en.json` with new features or text.
2. Run the script:
   ```bash
   python3 ui_sync_locales.py
   ```
3. Open `sync_report.txt` to see a checklist of what needs to be translated.
