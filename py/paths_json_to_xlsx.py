import json
import pandas as pd
import os
import re

# --- CONFIGURATION ---
# The source English file
INPUT_PATH = '../app/js/locales/en/learningPathways_en.json'
# The Excel file to be uploaded to Google Translate
OUTPUT_XLSX = 'paths_translate.xlsx'
# The mapping file used to re-insert translations later
MAP_FILE = 'paths_map.json'

# Fields containing human-readable text that require translation
WHITELIST = {'titleLevel1', 'titleLevel2', 'titleLevel3', 'description'}

def protect_placeholders(text):
    """
    Wraps {variables} in non-translate spans.
    Google Translate's Document engine respects the 'notranslate' class,
    ensuring code variables remain functional after translation.
    """
    if not isinstance(text, str): return text
    # Protect {variable} placeholders
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def extract_strings(data, path=""):
    """
    Recursively crawls the Learning Pathways JSON structure
    to find translatable strings and record their exact JSON path.
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
        print(f"❌ Error: Source file {INPUT_PATH} not found.")
        return

    # 1. Load the English source JSON
    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 2. Extract the strings and their paths
    strings = extract_strings(data)
    
    # 3. Save the Map file (Required for the re-insertion script)
    with open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(strings, f, indent=2)
    print(f"💾 Mapping saved to {MAP_FILE}")

    # 4. Save the Excel file for translation
    df = pd.DataFrame(strings)
    df.to_excel(OUTPUT_XLSX, index=False)
    
    print(f"✅ Success! {len(strings)} strings exported to {OUTPUT_XLSX}")
    print("👉 ACTION: Upload this file to the 'Documents' tab in Google Translate.")

if __name__ == "__main__":
    run()
