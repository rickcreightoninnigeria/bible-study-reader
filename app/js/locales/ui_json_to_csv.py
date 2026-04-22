import json
import csv
import os
import re

# Settings
INPUT_PATH = './en/ui_en.json'
OUTPUT_CSV = 'ui_to_translate.csv'

def protect_placeholders(text):
    # Wraps {variable} in a tag Google Translate respects as 'do not translate'
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def run_extraction():
    if not os.path.exists(INPUT_PATH):
        print(f"Error: Could not find {INPUT_PATH}")
        return

    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    rows = []
    for key, value in data.items():
        # 1. Skip comments and sections starting with ___
        if key.startswith('___'):
            continue
        
        # 2. Skip empty strings
        if not value or value.strip() == "":
            continue

        # 3. Protect placeholders and prepare row
        protected_text = protect_placeholders(value)
        rows.append([key, protected_text])

    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Key', 'Text']) # Header
        writer.writerows(rows)

    print(f"Success! {len(rows)} strings extracted to {OUTPUT_CSV}")

if __name__ == "__main__":
    run_extraction()
