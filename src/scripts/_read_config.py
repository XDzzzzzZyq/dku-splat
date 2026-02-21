import re
import json

with open("src/config.ts", "r") as f:
    text = f.read()

# Remove "export const CONFIG =" and "as const;"
text = re.sub(r"export\s+const\s+CONFIG\s*=\s*", "", text)
text = re.sub(r"\s*as\s+const\s*;", "", text)

# Remove block comments /* ... */
text = re.sub(r"/\*[\s\S]*?\*/", "", text)

# Remove single-line comments //
text = re.sub(r"//.*", "", text)

# Remove trailing commas before }
text = re.sub(r",\s*}", "}", text)

# Remove trailing commas before ]
text = re.sub(r",\s*]", "]", text)

# Convert single-quoted string literals to double-quoted JSON strings
text = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", r'"\1"', text)

# Quote keys to make valid JSON
text = re.sub(r"(\w+)\s*:", r'"\1":', text)

config = json.loads(text)
print("Loaded config:", config)