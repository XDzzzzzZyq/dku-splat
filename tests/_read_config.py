import re
import json

# Read the file
with open("src/config.ts", "r") as f:
    text = f.read()

# Remove "export const CONFIG =" and "as const;"
text = re.sub(r"export const CONFIG\s*=\s*", "", text)
text = re.sub(r"\s*as const\s*;", "", text)

# Replace single-line comments and trailing commas
text = re.sub(r"//.*", "", text)
text = re.sub(r",\s*}", "}", text)

# Convert to JSON: add quotes around keys
text = re.sub(r"(\w+)\s*:", r'"\1":', text)

config = json.loads(text)
print("Loaded config:", config)