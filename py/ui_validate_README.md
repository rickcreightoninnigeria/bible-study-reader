# UI Locale Validator (`ui_validate_locales.py`)

This script acts as the Quality Assurance layer for your localization workflow. It ensures that all translation files are syntactically correct and structurally aligned with the English source of truth.

## Core Features
*   **Syntax Guard**: Detects broken JSON (like missing commas) and reports them in a summary at the end rather than crashing.
*   **Variable Integrity**: Uses an ICU-aware regex to ensure that placeholders like `{count}` or complex plural logic like `{count, plural, one{} other{s}}` are preserved across all languages.
*   **HTML Validation**: Checks that opening tags (e.g., `<b>`) have corresponding closing tags to prevent UI layout breaks.
*   **Structural Comparison**: Identifies "Missing keys" (present in English but not the target) and "Orphaned keys" (junk data left in translations that is no longer in English).

## How to Use
1. Place the script inside your `/locales` directory.
2. Run the script:
   ```bash
   python3 ui_validate_locales.py
   ```
3. Review the output. If a language passes all checks, it will display `✅ No problems detected`. Otherwise, it will list specific key mismatches or syntax errors.
