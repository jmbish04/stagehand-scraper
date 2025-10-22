# Schema Testing

This directory contains tools for testing schema generation from natural language prompts.

## Files

- `test_schema.py` - Python script for testing schema generation
- `test_worker.py` - Comprehensive worker endpoint testing

## Usage

### Basic Schema Testing

Test a single natural language prompt:

```bash
pnpm run test:schema "Extract job listings with title, company, location, and salary"
```

### Schema Testing with Expected Results

Test against an expected schema:

```bash
pnpm run test:schema "Get product information including name, price, and reviews" --expected-schema '{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"},"reviews":{"type":"array","items":{"type":"string"}}}}}'
```

### Comprehensive Test Suite

Run all predefined test cases:

```bash
pnpm run test:schema --test-suite
```

## API Endpoint

The schema testing is available via the `/test-schema` API endpoint:

```bash
curl -X POST https://stagehand-scraper.hacolby.workers.dev/test-schema \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Extract job listings with title, company, location, and salary",
    "expectedSchema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "company": {"type": "string"},
          "location": {"type": "string"},
          "salary": {"type": "string"}
        }
      }
    }
  }'
```

## Response Format

```json
{
  "success": true,
  "prompt": "Extract job listings with title, company, location, and salary",
  "description": [
    {
      "name": "title",
      "type": "string",
      "description": "Job title"
    },
    {
      "name": "company",
      "type": "string", 
      "description": "Company name"
    }
  ],
  "generatedSchema": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "company": {"type": "string"}
      }
    }
  },
  "expectedSchema": {...},
  "match": true,
  "timestamp": "2025-10-22T03:48:37.000Z"
}
```

## Exit Codes

- `0` - Success (schema generated and matches if expected schema provided)
- `1` - Failure (schema generation failed)
- `2` - Schema mismatch (generated schema doesn't match expected)

## Test Cases

The test suite includes predefined cases for:

1. **Job Listings** - Extract job information with title, company, location, salary, requirements
2. **Product Information** - Get product details with name, price, description, ratings
3. **News Articles** - Extract news with headline, author, publish date, content summary
4. **Contact Information** - Get contact details with name, email, phone, address
