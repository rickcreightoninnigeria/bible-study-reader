```python?code_reference&code_event_index=1
markdown_ui_content = """# UI Strings Translation Tool

This folder contains a pair of Python scripts specifically designed for the `ui_en.json` file. This file contains the flat key-value pairs used for the application's interface (buttons, menus, and labels).

## Workflow Overview

1. **Extraction**: Run `ui_json_to_csv.py` to create a translation-ready CSV.
2. **Translation**: Upload the CSV to Google Translate.
3. **Re-insertion**: Run `ui_csv_to_json.py` to generate the translated JSON.

---

## Script 1: `ui_json_to_csv.py`

### What it does
- **Source Path**: Specifically looks for `./en/ui_en.json`.
- **Comment Filtering**: Automatically ignores any keys starting with `___` (used for developer comments and sections).
- **Placeholder Protection**: Detects variables like `{title}` or `{count}` and wraps them in `<span class="notranslate">` tags. This signals to Google Translate that these technical tokens must not be translated.
- **Two-Column Output**: Generates a CSV with both the **Key** and the **Text**. Having the key in the CSV makes the re-insertion process more robust.

### How to use
1. Ensure your file is at `./en/ui_en.json`.
2. Run the script:
   ```bash
   python ui_json_to_csv.py
   ```
3. **Output generated:**
   - `ui_to_translate.csv`: Open this or upload it to a translation service.

---

## Script 2: `ui_csv_to_json.py`

### What it does
- **Input**: Looks for `ui_translated.csv` in the current directory.
- **Cleanup**: Removes the `<span class="notranslate">` tags to restore clean `{variable}` syntax.
- **Reconstruction**: Maps the translated text back to the original keys.
- **Encoding**: Uses UTF-8 with `ensure_ascii=False` to ensure that non-Latin scripts (Chinese, Arabic, Greek, etc.) are saved as readable characters rather than Unicode escape sequences.

### How to use
1. After translating, save your file as `ui_translated.csv`.
2. Run the script:
   ```bash
   python ui_csv_to_json.py
   ```
3. **Output generated:**
   - `ui_translated.json`: The final file ready for use in your app's locale folder.

---

## Important Notes for UI Translation

- **Key Consistency**: Do not edit the content of the "Key" column in your CSV. The scripts use this column to match the translation to the correct UI element.
- **HTML Tags**: This script preserves HTML tags like `<b>` or `<i>`. Google Translate usually handles these well, but ensure they aren't accidentally deleted during manual edits.
- **Length Constraints**: Be aware that German, Dutch, and French words are often significantly longer than English. Check your UI after translation to ensure text doesn't overlap or break the layout.

## Requirements
- Python 3.x
- Standard libraries only (`json`, `csv`, `re`, `os`).
"""

with open('ui_README.md', 'w', encoding='utf-8') as f:
    f.write(markdown_ui_content)


### Key difference for the UI scripts:
Unlike the Study and AAD scripts which use a separate `map.json` because of their complex nesting, these UI scripts store the **Key** directly in the CSV. This makes the CSV a bit easier to read manually if you need to spot-check a specific button label.