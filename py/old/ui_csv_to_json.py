import json
import csv
import re
import os

# Settings
INPUT_CSV = 'ui_translated.csv'
OUTPUT_JSON = 'ui_translated.json'

def unprotect_placeholders(text):
    # Removes the protection tags added by Script 1
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    # Some translators might mess up the tags; this catches common errors
    text = text.replace('<span class = "notranslate">', '').replace('</span>', '')
    return text

def run_insertion():
    if not os.path.exists(INPUT_CSV):
        print(f"Error: {INPUT_CSV} not found in current directory.")
        return

    translated_data = {}

    with open(INPUT_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row['Key']
            # Clean up the text and restore placeholders
            clean_text = unprotect_placeholders(row['Text'])
            translated_data[key] = clean_text

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        # ensure_ascii=False handles Greek, Hebrew, etc. correctly
        json.dump(translated_data, f, indent=2, ensure_ascii=False)

    print(f"Success! {OUTPUT_JSON} has been created.")

if __name__ == "__main__":
    run_insertion()
