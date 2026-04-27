import json
import pandas as pd
import os
import re

# --- CONFIGURATION ---
# Source file location
INPUT_PATH = '../app/js/locales/en/libraryShelvesStructure_en.json'
# Output file for Google Translate
OUTPUT_XLSX = 'shelves_translate.xlsx'
# Mapping file used to re-insert text later
MAP_FILE = 'shelves_map.json'

# Fields containing human-readable text to be translated
WHITELIST = {'shelf', 'section', 'name', 'description'}

def protect_placeholders(text):
    """
    Wraps {variables} in HTML span tags.
    Google Translate's Document engine respects 'notranslate' classes, 
    preventing it from translating code variables like {count}.
    """
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def extract_strings(data, path=""):
    """
    Recursively crawls the JSON structure (objects and arrays) 
    to find whitelisted strings and record their 'dot-notation' path.
    """
    extracted = []
    if isinstance(data, dict):
        for key, value in data.items():
            new_path = f"{path}.{key}" if path else key
            if key in WHITELIST and isinstance(value, str):
                extracted.append({'path': new_path, 'text': protect_placeholders(value)})
            else:
                extracted.extend(extract_strings(value, new_path))
    elif isinstance(data, list):
        for i, item in enumerate(data):
            extracted.extend(extract_strings(item, f"{path}[{i}]"))
    return extracted

def run():
    print(f"🚀 Starting extraction from {INPUT_PATH}...")
    
    if not os.path.exists(INPUT_PATH):
        print(f"❌ Error: {INPUT_PATH} not found.")
        return

    # 1. Load Source JSON
    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 2. Extract Strings and their locations
    strings = extract_strings(data)
    
    # 3. Save Mapping File 
    # This is critical for the 'xlsx_to_json' script to know where each row belongs.
    with open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(strings, f, indent=2)
    print(f"💾 Mapping saved to {MAP_FILE}")

    # 4. Save XLSX for Translation using Pandas
    df = pd.DataFrame(strings)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    print(f"✅ Success! {len(strings)} strings exported to {OUTPUT_XLSX}")
    print("👉 ACTION: Upload this file to Google Translate (Documents tab).")

if __name__ == "__main__":
    run()
