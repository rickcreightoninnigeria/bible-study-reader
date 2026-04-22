import json
import os
from collections import OrderedDict
from datetime import datetime

# --- CONFIGURATION ---
BASE_DIR = "." 
SOURCE_LANG = "en"
SOURCE_FILE_NAME = f"ui_{SOURCE_LANG}.json"
SOURCE_PATH = os.path.join(BASE_DIR, SOURCE_LANG, SOURCE_FILE_NAME)
REPORT_FILE = "sync_report.txt"

def sync_locales():
    if not os.path.exists(SOURCE_PATH):
        print(f"❌ Error: Source file not found at {SOURCE_PATH}")
        return

    # Load English source with order preserved
    with open(SOURCE_PATH, 'r', encoding='utf-8') as f:
        source_data = json.load(f, object_pairs_hook=OrderedDict)

    report_lines = [f"Sync Report - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", "="*40]
    languages_processed = 0

    # Iterate through language directories
    for lang in os.listdir(BASE_DIR):
        lang_path = os.path.join(BASE_DIR, lang)
        if lang == SOURCE_LANG or not os.path.isdir(lang_path):
            continue
        
        target_file = f"ui_{lang}.json"
        target_path = os.path.join(lang_path, target_file)
        
        existing_translation = OrderedDict()
        if os.path.exists(target_path):
            with open(target_path, 'r', encoding='utf-8') as f:
                existing_translation = json.load(f, object_pairs_hook=OrderedDict)

        synced_data = OrderedDict()
        added_keys = []
        removed_keys = [k for k in existing_translation if k not in source_data and not k.startswith("___")]

        # Construct the synced version
        for key, source_val in source_data.items():
            if key.startswith("___"):
                synced_data[key] = source_val
            elif key in existing_translation:
                synced_data[key] = existing_translation[key]
            else:
                synced_data[key] = f"[TODO] {source_val}"
                added_keys.append(key)

        # Save updated file
        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(synced_data, f, ensure_ascii=False, indent=4)
        
        # Log findings for this language
        languages_processed += 1
        report_lines.append(f"\n🌍 LANGUAGE: {lang.upper()}")
        if added_keys:
            report_lines.append(f"   ➕ Added ({len(added_keys)}): {', '.join(added_keys)}")
        if removed_keys:
            report_lines.append(f"   🗑️  Removed ({len(removed_keys)}): {', '.join(removed_keys)}")
        if not added_keys and not removed_keys:
            report_lines.append("   ✅ No changes needed.")

    # Write the final report
    with open(REPORT_FILE, 'w', encoding='utf-8') as f:
        f.write("\n".join(report_lines))
    
    print(f"✅ Sync complete for {languages_processed} languages.")
    print(f"📑 Report generated: {REPORT_FILE}")

if __name__ == "__main__":
    sync_locales()
