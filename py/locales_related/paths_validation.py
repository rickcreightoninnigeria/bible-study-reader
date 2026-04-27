import json
import os
import re

# --- CONFIGURATION ---
SOURCE_FILE = "./en/learningPathways_en.json"
VAR_REGEX = re.compile(r"\{([a-zA-Z0-9_.-]+)\}")
HTML_TAG_REGEX = re.compile(r"<(/?[a-z1-6]+).*?>")

def get_placeholders(text):
    if not isinstance(text, str): return set()
    return set(VAR_REGEX.findall(text))

def validate_html(text):
    if not isinstance(text, str): return True
    tags = HTML_TAG_REGEX.findall(text)
    stack = []
    for tag in tags:
        if tag.startswith('/'):
            if not stack or stack[-1] != tag[1:]: return False
            stack.pop()
        else:
            if tag not in ['br', 'img', 'hr']: stack.append(tag)
    return len(stack) == 0

def validate_pathways_file(file_path):
    issues = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return [f"❌ JSON SYNTAX ERROR: {e}"]

    def check_recursive(obj, path="root"):
        if isinstance(obj, dict):
            for k, v in obj.items():
                current_path = f"{path}.{k}"
                if k in ['titleLevel1', 'titleLevel2', 'titleLevel3', 'description'] and isinstance(v, str):
                    # 1. HTML Check
                    if not validate_html(v):
                        issues.append(f"❌ Broken HTML at [{current_path}]")
                    # 2. Bracket Check
                    if v.count('{') != v.count('}'):
                        issues.append(f"⚠️  Mismatched braces at [{current_path}]")
                else:
                    check_recursive(v, current_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                check_recursive(item, f"{path}[{i}]")

    check_recursive(data)
    return issues

def run():
    print("🚀 Validating Learning Pathways Files...")
    print("="*40)
    
    files = [f for f in os.listdir('.') if f.startswith('learningPathways_') and f.endswith('.json')]
    
    if not files:
        print("No learningPathways_*.json files found in current directory.")
        return

    for file_name in files:
        print(f"🔍 Checking: {file_name}")
        errors = validate_pathways_file(file_name)
        if not errors:
            print("   ✅ Pass")
        else:
            for err in errors:
                print(f"   {err}")
        print("-" * 20)

if __name__ == "__main__":
    run()