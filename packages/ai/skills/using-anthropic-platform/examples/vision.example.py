#!/usr/bin/env python3
"""
Anthropic Vision Example

This example demonstrates image analysis capabilities with the Anthropic Claude API,
including base64 encoding, URL-based images, and multi-image comparison.

Usage:
    python vision.example.py image.jpg "Describe this image"
    python vision.example.py --url "https://example.com/image.jpg" "What's in this?"
    python vision.example.py --compare image1.jpg image2.jpg

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import sys
import base64
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from anthropic import Anthropic, APIError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def encode_image(image_path: str) -> tuple[str, str]:
    """Encode an image file to base64 and detect media type.

    Args:
        image_path: Path to the image file

    Returns:
        Tuple of (base64_data, media_type)
    """
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # Determine media type from extension
    extension = path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp"
    }

    media_type = media_types.get(extension)
    if not media_type:
        raise ValueError(f"Unsupported image format: {extension}")

    # Read and encode
    with open(path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")

    logger.info(f"Encoded {path.name} ({media_type})")
    return data, media_type


def analyze_image_file(image_path: str, prompt: str = "Describe this image in detail.") -> str:
    """Analyze an image from a file path.

    Args:
        image_path: Path to the image file
        prompt: Question or instruction about the image

    Returns:
        Claude's analysis of the image
    """
    print(f"\n=== Analyzing: {image_path} ===\n")

    client = Anthropic()
    image_data, media_type = encode_image(image_path)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ]
    )

    result = message.content[0].text
    logger.info(f"Tokens - Input: {message.usage.input_tokens}, Output: {message.usage.output_tokens}")

    return result


def analyze_image_url(url: str, prompt: str = "Describe this image in detail.") -> str:
    """Analyze an image from a URL.

    Args:
        url: URL of the image
        prompt: Question or instruction about the image

    Returns:
        Claude's analysis of the image
    """
    print(f"\n=== Analyzing URL: {url} ===\n")

    client = Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": url
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ]
    )

    result = message.content[0].text
    logger.info(f"Tokens - Input: {message.usage.input_tokens}, Output: {message.usage.output_tokens}")

    return result


def compare_images(image_paths: List[str], prompt: Optional[str] = None) -> str:
    """Compare multiple images.

    Args:
        image_paths: List of paths to image files
        prompt: Optional custom comparison prompt

    Returns:
        Claude's comparison of the images
    """
    print(f"\n=== Comparing {len(image_paths)} images ===\n")

    if not prompt:
        prompt = "Compare these images. What are the similarities and differences? Which aspects stand out in each?"

    client = Anthropic()

    # Build content with all images
    content: List[Dict[str, Any]] = []

    for i, path in enumerate(image_paths):
        image_data, media_type = encode_image(path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": image_data
            }
        })
        logger.info(f"Added image {i+1}: {path}")

    # Add the prompt
    content.append({
        "type": "text",
        "text": prompt
    })

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )

    result = message.content[0].text
    logger.info(f"Tokens - Input: {message.usage.input_tokens}, Output: {message.usage.output_tokens}")

    return result


def detailed_analysis(image_path: str) -> str:
    """Perform a detailed structured analysis of an image.

    Args:
        image_path: Path to the image file

    Returns:
        Structured analysis of the image
    """
    print(f"\n=== Detailed Analysis: {image_path} ===\n")

    prompt = """Analyze this image and provide a structured response with:

1. **Overview**: A brief one-sentence description
2. **Main Subject**: What is the primary focus of the image?
3. **Colors**: Dominant colors and color palette
4. **Composition**: How elements are arranged
5. **Mood/Atmosphere**: The feeling or emotion conveyed
6. **Technical Observations**: Quality, style, notable techniques
7. **Context Clues**: Any text, logos, or identifying information

Please be thorough but concise in each section."""

    return analyze_image_file(image_path, prompt)


def extract_text(image_path: str) -> str:
    """Extract and transcribe text from an image (OCR).

    Args:
        image_path: Path to the image file

    Returns:
        Extracted text from the image
    """
    print(f"\n=== Extracting Text: {image_path} ===\n")

    prompt = """Please extract and transcribe all text visible in this image.

Format the output as follows:
- Preserve the general layout and structure where possible
- Use markdown formatting for headers, lists, etc.
- Note any text that is unclear or partially visible
- If there is no text in the image, state that clearly"""

    return analyze_image_file(image_path, prompt)


def run_demo():
    """Run a demo with a test image URL."""
    print("=" * 60)
    print("Anthropic Vision Demo")
    print("=" * 60)

    # Using a sample image URL for demo
    demo_url = "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"

    print("\nDemo: Analyzing a sample image from Wikipedia")
    print(f"URL: {demo_url}\n")

    try:
        result = analyze_image_url(demo_url, "Describe what you see in this image. What type of animal is it? What is it doing?")
        print(result)
    except APIError as e:
        print(f"API Error: {e}")
        print("\nNote: URL-based image analysis requires the URL to be publicly accessible.")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python vision.example.py <image.jpg> [prompt]")
        print("  python vision.example.py --url <url> [prompt]")
        print("  python vision.example.py --compare <image1.jpg> <image2.jpg> [prompt]")
        print("  python vision.example.py --detailed <image.jpg>")
        print("  python vision.example.py --ocr <image.jpg>")
        print("  python vision.example.py --demo")
        print("\nExamples:")
        print('  python vision.example.py photo.jpg "What objects are in this image?"')
        print('  python vision.example.py --url https://example.com/img.jpg "Describe this"')
        print('  python vision.example.py --compare before.jpg after.jpg')
        print('  python vision.example.py --detailed screenshot.png')
        print('  python vision.example.py --ocr document.png')
        sys.exit(1)

    try:
        if sys.argv[1] == "--demo":
            run_demo()

        elif sys.argv[1] == "--url":
            if len(sys.argv) < 3:
                print("Error: URL required")
                sys.exit(1)
            url = sys.argv[2]
            prompt = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else "Describe this image."
            result = analyze_image_url(url, prompt)
            print(result)

        elif sys.argv[1] == "--compare":
            if len(sys.argv) < 4:
                print("Error: At least 2 images required for comparison")
                sys.exit(1)
            # Find where prompt starts (first arg that doesn't look like a file)
            images = []
            prompt_parts = []
            for arg in sys.argv[2:]:
                if Path(arg).exists() or (not prompt_parts and arg.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp'))):
                    images.append(arg)
                else:
                    prompt_parts.append(arg)

            prompt = " ".join(prompt_parts) if prompt_parts else None
            result = compare_images(images, prompt)
            print(result)

        elif sys.argv[1] == "--detailed":
            if len(sys.argv) < 3:
                print("Error: Image path required")
                sys.exit(1)
            result = detailed_analysis(sys.argv[2])
            print(result)

        elif sys.argv[1] == "--ocr":
            if len(sys.argv) < 3:
                print("Error: Image path required")
                sys.exit(1)
            result = extract_text(sys.argv[2])
            print(result)

        else:
            # Default: analyze single image
            image_path = sys.argv[1]
            prompt = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Describe this image in detail."
            result = analyze_image_file(image_path, prompt)
            print(result)

    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)

    except APIError as e:
        print(f"API Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
