#!/usr/bin/env python3
"""
Schema Testing Script for Stagehand Scraper

This script tests the schema generation endpoint by providing natural language prompts
and optionally comparing against expected schemas.

Usage:
    pnpm run test:schema "Extract job listings with title, company, location, and salary"
    pnpm run test:schema "Get product information including name, price, and reviews" --expected-schema '{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"},"reviews":{"type":"array","items":{"type":"string"}}}}}'
"""

import json
import sys
import time
import argparse
from typing import Dict, Any, Optional
import requests

BASE_URL = "https://stagehand-scraper.hacolby.workers.dev"


def test_schema_generation(prompt: str, expected_schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Test schema generation from natural language prompt.
    
    Args:
        prompt: Natural language description of data to extract
        expected_schema: Optional expected JSON schema for comparison
        
    Returns:
        Dictionary containing test results
    """
    print(f"🧪 Testing schema generation...")
    print(f"📝 Prompt: {prompt}")
    if expected_schema:
        print(f"🎯 Expected Schema: {json.dumps(expected_schema, indent=2)}")
    print()
    
    payload = {
        "prompt": prompt,
        "expectedSchema": expected_schema
    }
    
    start_time = time.time()
    try:
        response = requests.post(
            f"{BASE_URL}/test-schema",
            json=payload,
            timeout=30
        )
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"⏱️  Duration: {duration:.2f} seconds")
        print(f"📡 Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Test Results
            success = data.get('success', False)
            match = data.get('match')
            generated_schema = data.get('generatedSchema')
            description = data.get('description', [])
            
            print(f"\n📊 Test Results:")
            print(f"   ✅ Success: {'PASS' if success else 'FAIL'}")
            
            if success:
                print(f"   📋 Generated Fields: {len(description)}")
                for field in description:
                    print(f"      • {field.get('name', 'unknown')} ({field.get('type', 'unknown')})")
                    if field.get('description'):
                        print(f"        {field.get('description')}")
                
                print(f"\n🔧 Generated Schema:")
                print(json.dumps(generated_schema, indent=2))
                
                if expected_schema is not None:
                    if match is True:
                        print(f"\n🎯 Schema Match: ✅ PERFECT MATCH")
                    elif match is False:
                        print(f"\n🎯 Schema Match: ❌ MISMATCH")
                        print(f"   Expected:")
                        print(json.dumps(expected_schema, indent=2))
                    else:
                        print(f"\n🎯 Schema Match: ⚠️  Could not compare")
                else:
                    print(f"\n🎯 Schema Match: ⚠️  No expected schema provided")
            else:
                error = data.get('error', 'Unknown error')
                print(f"   ❌ Error: {error}")
            
            return {
                'success': success,
                'match': match,
                'duration': duration,
                'status_code': response.status_code,
                'data': data
            }
        else:
            print(f"❌ Request failed with status {response.status_code}")
            try:
                error_data = response.json()
                print(f"   Error: {error_data.get('error', 'Unknown error')}")
            except:
                print(f"   Response: {response.text}")
            
            return {
                'success': False,
                'match': False,
                'duration': duration,
                'status_code': response.status_code,
                'error': response.text
            }
            
    except requests.exceptions.Timeout:
        end_time = time.time()
        duration = end_time - start_time
        print(f"⏰ Request timed out after {duration:.2f} seconds")
        return {
            'success': False,
            'match': False,
            'duration': duration,
            'error': 'Request timeout'
        }
    except Exception as e:
        end_time = time.time()
        duration = end_time - start_time
        print(f"❌ Error: {str(e)}")
        return {
            'success': False,
            'match': False,
            'duration': duration,
            'error': str(e)
        }


def run_test_suite():
    """Run a comprehensive test suite of schema generation scenarios."""
    print("🚀 Running Schema Generation Test Suite")
    print("=" * 60)
    
    test_cases = [
        {
            'name': 'Job Listings',
            'prompt': 'Extract job listings with title, company, location, salary, and requirements',
            'expected_schema': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'title': {'type': 'string'},
                        'company': {'type': 'string'},
                        'location': {'type': 'string'},
                        'salary': {'type': 'string'},
                        'requirements': {'type': 'array', 'items': {'type': 'string'}}
                    }
                }
            }
        },
        {
            'name': 'Product Information',
            'prompt': 'Get product details including name, price, description, and customer ratings',
            'expected_schema': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string'},
                        'price': {'type': 'number'},
                        'description': {'type': 'string'},
                        'ratings': {'type': 'number'}
                    }
                }
            }
        },
        {
            'name': 'News Articles',
            'prompt': 'Extract news articles with headline, author, publish date, and content summary',
            'expected_schema': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'headline': {'type': 'string'},
                        'author': {'type': 'string'},
                        'publish_date': {'type': 'string'},
                        'summary': {'type': 'string'}
                    }
                }
            }
        },
        {
            'name': 'Contact Information',
            'prompt': 'Get contact details including name, email, phone, and address',
            'expected_schema': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string'},
                        'email': {'type': 'string'},
                        'phone': {'type': 'string'},
                        'address': {'type': 'string'}
                    }
                }
            }
        }
    ]
    
    results = []
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n🧪 Test {i}: {test_case['name']}")
        print("-" * 40)
        
        result = test_schema_generation(
            test_case['prompt'], 
            test_case['expected_schema']
        )
        result['test_name'] = test_case['name']
        results.append(result)
        
        time.sleep(1)  # Brief pause between tests
    
    # Summary
    print(f"\n📊 Test Suite Summary")
    print("=" * 60)
    
    successful_tests = sum(1 for r in results if r['success'])
    total_tests = len(results)
    perfect_matches = sum(1 for r in results if r.get('match') is True)
    avg_duration = sum(r['duration'] for r in results) / total_tests
    
    print(f"✅ Successful Tests: {successful_tests}/{total_tests}")
    print(f"🎯 Perfect Schema Matches: {perfect_matches}/{total_tests}")
    print(f"⏱️  Average Duration: {avg_duration:.2f} seconds")
    
    print(f"\n📋 Detailed Results:")
    for result in results:
        status = "✅ PASS" if result['success'] else "❌ FAIL"
        match_status = ""
        if result.get('match') is True:
            match_status = " 🎯 MATCH"
        elif result.get('match') is False:
            match_status = " ❌ MISMATCH"
        
        print(f"   {result['test_name']}: {status}{match_status} ({result['duration']:.2f}s)")
    
    return results


def main():
    parser = argparse.ArgumentParser(description='Test schema generation from natural language')
    parser.add_argument('prompt', nargs='?', help='Natural language prompt for schema generation')
    parser.add_argument('--expected-schema', help='Expected JSON schema for comparison')
    parser.add_argument('--test-suite', action='store_true', help='Run comprehensive test suite')
    
    args = parser.parse_args()
    
    if args.test_suite:
        run_test_suite()
    elif args.prompt:
        expected_schema = None
        if args.expected_schema:
            try:
                expected_schema = json.loads(args.expected_schema)
            except json.JSONDecodeError as e:
                print(f"❌ Invalid JSON in expected schema: {e}")
                sys.exit(1)
        
        result = test_schema_generation(args.prompt, expected_schema)
        
        # Exit with appropriate code
        if result['success']:
            if expected_schema is None or result.get('match') is not False:
                sys.exit(0)  # Success
            else:
                sys.exit(2)  # Schema mismatch
        else:
            sys.exit(1)  # Failure
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
