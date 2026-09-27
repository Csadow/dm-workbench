# Third-party content

## System Reference Document 5.2.1

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

`assets/srd-monsters.json` contains the 330 stat blocks from “Monsters A–Z” and “Animals” in the official English SRD 5.2.1. Source: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf.

Changes: extracted to JSON, normalized PDF line breaks, spacing and minus glyphs. The application adds Russian search aliases and interface labels; these are editorial additions, not an official translation. No game statistics have been intentionally changed. The source PDF hash is recorded in the JSON. Rebuild with `python scripts/build-bestiary.py /path/to/SRD_CC_v5.2.1.pdf`; this developer step needs Poppler's `pdftotext`.

The catalogue is the openly licensed SRD subset. It does not include all Monster Manual or other paid D&D Beyond content. No D&D Beyond account credentials, scraping of paid books, or unofficial data APIs are used.

## Local AI runtime

Ollama and Qwen3.5 are downloaded separately during local setup, into the ignored `.local-ai/` directory; neither their binaries nor model weights are committed to this repository. Their license and notice files are provided by their respective distributions.

- Ollama: https://github.com/ollama/ollama
- Qwen3.5 model catalogue: https://ollama.com/library/qwen3.5
