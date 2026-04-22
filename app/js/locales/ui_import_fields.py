import json
import csv
import os
import subprocess
from collections import OrderedDict

# --- CONFIGURATION ---
BASE_DIR = "."
SOURCE_LANG = "en"
CSV_FILE = "import_fields.csv"
VALIDATOR_SCRIPT = "ui_validate_locales.py"

def insert_into_ordered_dict(d, key, value, after_key=None):
    """Inserts a key-value pair after a specific anchor key, or updates if exists."""
    new_dict = OrderedDict()
    
    # If key exists, update value but keep its original position
    if key in d:
        for k, v in d.items():
            new_dict[k] = value if k == key else v
        return new_dict

    # If key is new and no anchor provided, append to end
    if not after_key:
        d[key] = value
        return d
    
    # If key is new and anchor provided, insert after anchor
    found_anchor = False
    for k, v in d.items():
        new_dict[k] = v
        if k == after_key:
            new_dict[key] = value
            found_anchor = True
            
    if not found_anchor:
        # If anchor wasn't found in this specific file, append to end
        new_dict[key] = value
    return new_dict

def import_from_csv():
    if not os.path.exists(CSV_FILE):
        print(f"❌ CSV file not found: {CSV_FILE}")
        return

    updates = {} # { lang: { key: value } }
    anchors = {} # { key: anchor_key }

    # 1. Parse CSV
    try:
        with open(CSV_FILE, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            for row in reader:
                if not row or len(row) < 3: continue
                
                key, lang_or_cmd, content = [item.strip() for item in row]

                if lang_or_cmd.lower() == "anchor":
                    anchors[key] = content
                elif lang_or_cmd == SOURCE_LANG:
                    continue # Skip English as per instructions
                else:
                    if lang_or_cmd not in updates:
                        updates[lang_or_cmd] = {}
                    updates[lang_or_cmd][key] = content
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return

    # 2. Process Files
    for lang, fields in updates.items():
        file_name = f"ui_{lang}.json"
        file_path = os.path.join(BASE_DIR, lang, file_name)
        
        if not os.path.exists(file_path):
            print(f"⚠️  Skipping {lang.upper()}: {file_name} not found.")
            continue

        with open(file_path, 'r', encoding='utf-8') as f:
            try:
                data = json.load(f, object_pairs_hook=OrderedDict)
            except json.JSONDecodeError:
                print(f"❌ {lang.upper()}: Skipping due to existing JSON syntax error.")
                continue

        for key, value in fields.items():
            anchor = anchors.get(key)
            status = "Updated" if key in data else "Added"
            
            data = insert_into_ordered_dict(data, key, value, anchor)
            print(f"✨ {lang.upper()}: {status} '{key}'")

        # 3. Write Back
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

    # 4. Final Validation
    print("\n" + "="*40)
    print("🚀 Triggering Validation Suite...")
    if os.path.exists(VALIDATOR_SCRIPT):
        subprocess.run(["python3", VALIDATOR_SCRIPT])
    else:
        print(f"⚠️  Could not find {VALIDATOR_SCRIPT} to run validation.")

if __name__ == "__main__":
    import_from_csv()
