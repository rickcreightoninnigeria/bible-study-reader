# Library Shelves Translation Tool

This tool manages the translation of the `libraryShelvesStructure_en.json` file, which defines the hierarchy of shelves, sections, and subsections in the library.

## File List
- `shelves_json_to_csv.py`: Extraction script.
- `shelves_csv_to_json.py`: Re-insertion script.
- `./en/libraryShelvesStructure_en.json`: The source English file.

## Workflow
1. **Extract**: Run `python shelves_json_to_csv.py`. 
   - This creates `shelves_to_translate.csv` (for translation) and `shelves_map.json` (do not edit).
2. **Translate**: Upload `shelves_to_translate.csv` to Google Translate.
3. **Prepare**: Save the result as `shelves_translated.csv` in the current folder.
4. **Finalize**: Run `python shelves_csv_to_json.py`.

## Technical Details
- **Variable Protection**: Strings containing placeholders like `{count}` are wrapped in `<span>` tags to prevent Google Translate from altering the code syntax.
- **Deep Nesting**: The tool specifically targets the `shelf`, `section`, and `subsections` objects, ensuring descriptions and names are correctly mapped back to their deep array indices.
- **Encoding**: The output is saved in UTF-8 with `ensure_ascii=False` to preserve the visual characters of languages such as Russian, Hebrew, or Chinese.