This README is for the **Study Translation Tool**, which handles the most complex of your files: `Grow_in_Christ_en_study.json`. Because this file contains deep nesting (chapters, elements, and metadata), this tool uses a "Mapping" system to ensure every string returns to its exact nested home.

---

# Study Content Translation Tool

This folder contains a pair of Python scripts specifically designed for the **Study JSON** files (e.g., `Grow_in_Christ_en_study.json`). Unlike the UI files, these contain deeply nested arrays of chapters, verses, and reflection questions.

## Workflow Overview

1. **Extraction**: Run `study_json_to_csv.py` to crawl the nested structure and extract text.
2. **Translation**: Upload the CSV to Google Translate.
3. **Re-insertion**: Run `study_csv_to_json.py` to rebuild the complex JSON with new translations.

---

## Script 1: `study_json_to_csv.py`

### What it does
- **Recursive Extraction**: Navigates through infinite levels of nesting (e.g., `chapters` -> `elements` -> `passageText`).
- **Theological Whitelist**: Targets fields critical for the study: `title`, `description`, `question`, `passageText`, and `bibleRef`.
- **Smart Filtering**: 
    - **Skips** `elementId` (important for app logic).
    - **Skips** hex color codes (e.g., `#edf2ed`) in the theme section.
    - **Skips** URLs and version numbers.
- **Mapping**: Creates a `map.json` file that records the exact "coordinate" of every string.

### How to use
1. Place your source file in the main directory (or update the script path).
2. Run the script:
   ```bash
   python study_json_to_csv.py
   ```
3. **Outputs generated:**
   - `to_translate.csv`: The list of English strings for Google Translate.
   - `map.json`: The "GPS coordinates" for your data. **Do not delete or edit this file.**

---

## Script 2: `study_csv_to_json.py`

### What it does
- **Deep Re-insertion**: Uses the `map.json` to find the exact array index and key for every translated string.
- **Encoding**: Saves the file with `ensure_ascii=False`, which is critical for languages like **Greek, Hebrew, and Chinese** to remain readable in the code.
- **Preservation**: Leaves all non-translated fields (IDs, colors, logic) exactly as they were in the English original.

### How to use
1. Rename your translated file from Google to `translated.csv`.
2. Ensure `map.json` and your original English JSON are in the folder.
3. Run the script:
   ```bash
   python study_csv_to_json.py
   ```
4. **Output generated:**
   - `Grow_in_Christ_translated.json`: The fully translated, nested study file.

---

## Special Considerations for Study Files

- **Bible References**: This script **includes** Bible references (e.g., "John 3:16") for translation. Google Translate will usually convert book names to the target language correctly.
- **HTML in Scripture**: If your `passageText` contains `<sup>` tags for verse numbers or `<b>` for emphasis, these are preserved. Verify in the final JSON that Google hasn't added spaces inside the tags (e.g., `< b >` instead of `<b>`).
- **Row Count**: The mapping relies on the number of rows. If you manually add or delete rows in the CSV during translation, the re-insertion will fail or mismatch.

## Requirements
- Python 3.x
- Standard libraries only (`json`, `csv`, `os`).