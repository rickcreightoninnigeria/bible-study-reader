import json
import csv
import os
import re

# Settings
INPUT_PATH = './en/learningPathways_en.json'
OUTPUT_CSV = 'paths_to_translate.csv'
MAP_FILE = 'paths_map.json'

# Fields to translate
WHITELIST = {'titleLevel1', 'titleLevel2', 'titleLevel3', 'description'}

def protect_placeholders(text):
    # Protects any {variable} or HTML tags like <b>
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def extract_strings(data, path=""):
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
    if not os.path.exists(INPUT_PATH):
        print(f"Error: {INPUT_PATH} not found.")
        return

    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    strings = extract_strings(data)
    
    with open(MAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(strings, f, indent=2)

    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Path', 'Text'])
        for s in strings:
            writer.writerow([s['path'], s['text']])

    print(f"Extracted {len(strings)} strings to {OUTPUT_CSV}")

if __name__ == "__main__":
    run()