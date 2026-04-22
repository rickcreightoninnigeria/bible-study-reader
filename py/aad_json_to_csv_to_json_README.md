# App About Data Translation Tool (AAD)

This folder contains a pair of Python scripts designed to extract translatable text from `appAboutData_en.json` and re-insert the translations back into a new JSON file while preserving the original structure.

## Workflow Overview

1. **Extraction**: Run `aad_json_to_csv.py` to pull text from the source JSON into a CSV.
2. **Translation**: Upload the CSV to Google Translate (or any translation service).
3. **Re-insertion**: Run `aad_csv_to_json.py` to merge the translated text back into a valid JSON file.

---

## Script 1: `aad_json_to_csv.py`

### What it does
- Locates the source file at `./en/appAboutData_en.json`.
- Traverses the JSON structure (including nested license arrays).
- **Whitelists** only human-readable fields (e.g., `appDescription`, `freedoms`, `notices`).
- **Skips** technical keys like `url`, `spdxId`, or version strings.
- **Protects** variables like `{title}` by wrapping them in `<span class="notranslate">` tags so Google Translate doesn't break them.

### How to use
1. Ensure your source file is located at `./en/appAboutData_en.json`.
2. Open your terminal/command prompt and run:
   ```bash
   python aad_json_to_csv.py
   ```
3. **Outputs generated:**
   - `aad_to_translate.csv`: The file to be uploaded for translation.
   - `aad_map.json`: A temporary mapping file used by the second script (do not delete this!).

---

## Script 2: `aad_csv_to_json.py`

### What it does
- Reads the translated CSV.
- Uses the `aad_map.json` to identify exactly where each string belongs in the original JSON structure.
- **Cleans** the text by removing the `<span class="notranslate">` protection tags.
- Handles special characters (Greek, Hebrew, Cyrillic, etc.) using UTF-8 encoding.

### How to use
1. Take the translated file from Google Translate and rename it to `aad_translated.csv`.
2. Place `aad_translated.csv` in the same directory as the script.
3. Run the script:
   ```bash
   python aad_csv_to_json.py
   ```
4. **Output generated:**
   - `appAboutData_translated.json`: Your final, translated JSON file.

---

## Translation Tips for Google Translate

- **Document Upload**: Use the "Documents" tab on Google Translate for the best results with CSV files.
- **Column Handling**: Ensure the "Path" column remains unchanged. The script relies on the row order and the path keys to match the text.
- **Placeholders**: If you see `<span class="notranslate">{variable}</span>` in the translation, leave it exactly like that. The re-insertion script will strip the tags and leave the `{variable}` behind.

## Requirements
- Python 3.x
- No external libraries required (uses standard `json`, `csv`, and `re` modules).
"""

with open('aad_README.md', 'w', encoding='utf-8') as f:
    f.write(markdown_content)


### Quick Summary of the Workflow:
1.  **Extract:** Run `python aad_json_to_csv.py`. You will get a CSV and a Map file.
2.  **Translate:** Upload `aad_to_translate.csv` to Google Translate. Download the result.
3.  **Rename:** Save the result as `aad_translated.csv` in your main folder.
4.  **Insert:** Run `python aad_csv_to_json.py`. Your translated JSON will be created instantly.