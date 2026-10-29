"""Languages Tadaaam can transcribe today (first wave = what Sarvam supports),
with the default caption script for each. Output-script defaults other than
Hindi are provisional until the owner decides (plan §12 item 3)."""

LANGUAGES = [
    {"code": "hi", "name": "Hindi / Hinglish", "script": "Deva", "default_output": "roman"},
    {"code": "en", "name": "English (India)", "script": "Latn", "default_output": "native"},
    {"code": "mr", "name": "Marathi", "script": "Deva", "default_output": "native"},
    {"code": "bn", "name": "Bengali", "script": "Beng", "default_output": "native"},
    {"code": "ta", "name": "Tamil", "script": "Taml", "default_output": "native"},
    {"code": "te", "name": "Telugu", "script": "Telu", "default_output": "native"},
    {"code": "gu", "name": "Gujarati", "script": "Gujr", "default_output": "native"},
    {"code": "pa", "name": "Punjabi", "script": "Guru", "default_output": "native"},
    {"code": "kn", "name": "Kannada", "script": "Knda", "default_output": "native"},
    {"code": "ml", "name": "Malayalam", "script": "Mlym", "default_output": "native"},
    {"code": "or", "name": "Odia", "script": "Orya", "default_output": "native"},
    {"code": "as", "name": "Assamese", "script": "Beng", "default_output": "native"},
    {"code": "ur", "name": "Urdu", "script": "Arab", "default_output": "native"},
    {"code": "ne", "name": "Nepali", "script": "Deva", "default_output": "native"},
    {"code": "kok", "name": "Konkani", "script": "Deva", "default_output": "native"},
    {"code": "ks", "name": "Kashmiri", "script": "Arab", "default_output": "native"},
    {"code": "sd", "name": "Sindhi", "script": "Arab", "default_output": "native"},
    {"code": "sa", "name": "Sanskrit", "script": "Deva", "default_output": "native"},
    {"code": "sat", "name": "Santali", "script": "Olck", "default_output": "native"},
    {"code": "mni", "name": "Manipuri", "script": "Beng", "default_output": "native"},
    {"code": "brx", "name": "Bodo", "script": "Deva", "default_output": "native"},
    {"code": "mai", "name": "Maithili", "script": "Deva", "default_output": "native"},
    {"code": "doi", "name": "Dogri", "script": "Deva", "default_output": "native"},
]
LANGUAGE_CODES = {language["code"] for language in LANGUAGES}
