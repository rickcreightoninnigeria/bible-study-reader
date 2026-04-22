# Learning Pathways Translation Tool

This tool handles the translation of the `learningPathways_en.json` file, which contains structured data for curated study sequences.

## Files
- `paths_json_to_csv.py`: Extracts titles and descriptions.
- `paths_csv_to_json.py`: Re-inserts translations.
- `./en/learningPathways_en.json`: The source file.

## Workflow
1. **Extract**: Run `python lp_json_to_csv.py`. This generates `lp_to_translate.csv` and a `lp_map.json`.
2. **Translate**: Upload `lp_to_translate.csv` to Google Translate. Download the translated result.
3. **Prepare**: Rename the downloaded file to `lp_translated.csv` and place it in this folder.
4. **Build**: Run `python lp_csv_to_json.py`.

## Technical Notes
- **Placeholders**: Any HTML tags (like `<b>`) are protected during extraction so that the translation engine does not alter the code.
- **Deep Nesting**: This script handles the three-level deep array structure (`titleLevel1` down to `titleLevel3`) automatically.
- **Encoding**: The output JSON uses UTF-8 encoding, ensuring that non-Latin characters (Chinese, Russian, etc.) are saved correctly.