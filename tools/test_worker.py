import json
import sys
import time
import uuid
from urllib.parse import urljoin
from typing import Dict, Any, Tuple

import requests

BASE = "https://stagehand-scraper.hacolby.workers.dev".rstrip("/")

# Job page profiles
JOB_PAGE_PROFILES = {
    "1": {
        "name": "Cloudflare",
        "url": "https://www.cloudflare.com/careers/jobs/",
        "prompt": "Extract the job title, description, core responsibilities, experience, location, work from home / rto / hybrid policy, salary, benefits, and the link for each job listing on the page.",
        "waitForSelector": "a[href*='/careers/jobs/']"
    },
    "2": {
        "name": "OpenAI",
        "url": "https://openai.com/careers/search/",
        "prompt": "Extract the job title, description, core responsibilities, experience, location, work from home / rto / hybrid policy, salary, benefits, and the link for each job listing on the page.",
        "waitForSelector": "a[href*='/careers/']"
    },
    "3": {
        "name": "Cooley",
        "url": "https://www.cooley.com/careers/business-professionals-and-paralegals/business-professionals-paralegal-openings",
        "prompt": "Extract the job title, description, core responsibilities, experience, location, work from home / rto / hybrid policy, salary, benefits, and the link for each job listing on the page.",
        "waitForSelector": "a[href*='job-details?jobid=']"
    }
}


def get_user_input(prompt: str, default: str = "") -> str:
    """Get user input with optional default value."""
    if default:
        user_input = input(f"{prompt} [{default}]: ").strip()
        return user_input if user_input else default
    else:
        return input(f"{prompt}: ").strip()


def post_with_timing(path: str, payload: Dict[str, Any]) -> Tuple[requests.Response, float]:
    """Make POST request and measure execution time."""
    url = urljoin(BASE + "/", path.lstrip("/"))
    print(f"\n🚀 Testing {path}...")
    print(f"📡 POST {url}")
    
    start_time = time.time()
    try:
        r = requests.post(url, json=payload, timeout=300)  # Increased timeout for complex operations
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"✅ Status: {r.status_code}")
        print(f"⏱️  Duration: {duration:.2f} seconds")
        
        if r.status_code == 200:
            try:
                response_data = r.json()
                print(f"📊 Response keys: {list(response_data.keys())}")
                
                # Show request_id if available
                if 'request_id' in response_data:
                    print(f"🆔 Request ID: {response_data['request_id']}")
                
                # Show data preview if available
                if 'data' in response_data:
                    data_preview = str(response_data['data'])[:200]
                    print(f"📄 Data preview: {data_preview}...")
                    # Show full data if it's not too large
                    if len(str(response_data['data'])) < 2000:
                        print(f"📄 Full extracted data:")
                        print(json.dumps(response_data['data'], indent=2))
                elif 'result' in response_data:
                    result = response_data['result']
                    # Check if this is a judge endpoint result with extracted content
                    if isinstance(result, dict) and 'finalContent' in result:
                        content = result['finalContent']
                        print(f"📄 Extracted content preview: {content[:200]}...")
                        if len(content) < 2000:
                            print(f"📄 Full extracted content:")
                            print(content)
                        # Also show if goal was achieved
                        if 'achieved' in result:
                            print(f"🎯 Goal achieved: {result['achieved']}")
                    else:
                        result_preview = str(result)[:200]
                        print(f"📄 Result preview: {result_preview}...")
                        # Show full result if it's not too large
                        if len(str(result)) < 2000:
                            print(f"📄 Full result:")
                            print(json.dumps(result, indent=2))
                elif 'extractedData' in response_data:
                    extracted_preview = str(response_data['extractedData'])[:200]
                    print(f"📄 Extracted data preview: {extracted_preview}...")
                    # Show full extracted data if it's not too large
                    if len(str(response_data['extractedData'])) < 2000:
                        print(f"📄 Full extracted data:")
                        print(json.dumps(response_data['extractedData'], indent=2))
                elif 'cloudflare' in response_data:
                    cf_preview = str(response_data['cloudflare'])[:200]
                    print(f"📄 Cloudflare response preview: {cf_preview}...")
                    # Show full cloudflare response if it's not too large
                    if len(str(response_data['cloudflare'])) < 2000:
                        print(f"📄 Full Cloudflare response:")
                        print(json.dumps(response_data['cloudflare'], indent=2))
                    
            except json.JSONDecodeError:
                print(f"📄 Response text: {r.text[:500]}...")
        else:
            print(f"❌ Error response: {r.text[:500]}...")
            
        return r, duration
        
    except requests.exceptions.Timeout:
        end_time = time.time()
        duration = end_time - start_time
        print(f"⏰ Request timed out after {duration:.2f} seconds")
        return None, duration
    except Exception as e:
        end_time = time.time()
        duration = end_time - start_time
        print(f"❌ Error: {str(e)}")
        return None, duration


def test_endpoints(config: Dict[str, str]) -> Dict[str, Dict[str, Any]]:
    """Test all available endpoints and return results with timing."""
    results = {}
    
    # Generate a session ID for all tests to share the same requestId
    session_id = str(uuid.uuid4())
    print(f"🆔 Session ID: {session_id}")
    print("📡 All tests will use the same requestId for WebSocket tracking")
    
    # Test 1: /stagehand (regular scraping) - SKIPPED
    print("\n" + "="*60)
    print("🧪 TEST 1: /stagehand - Regular Stagehand Scraping (SKIPPED)")
    print("="*60)
    print("⏭️  Skipping Stagehand test as requested")
    
    results["stagehand"] = {
        "success": True,  # Mark as success since we're intentionally skipping
        "duration": 0.0,
        "status_code": 200,
        "request_id": None,
        "skipped": True
    }
    
    # Test 2: /judge (Llama 4 evaluator optimizer)
    print("\n" + "="*60)
    print("🧪 TEST 2: /judge - Llama 4 Evaluator Optimizer")
    print("="*60)
    
    judge_payload = {
        "url": config["url"],
        "goal": f"Successfully extract job information from {config['url']}",
        "waitForSelector": config.get("waitForSelector"),
        "capture": "both",
        "maxSteps": 4,
        "requestId": session_id
    }
    
    response, duration = post_with_timing("/judge", judge_payload)
    results["judge"] = {
        "success": response is not None and response.status_code == 200,
        "duration": duration,
        "status_code": response.status_code if response else None,
        "request_id": response.json().get("request_id") if response and response.status_code == 200 else None
    }
    
    # Test 3: /json-extract-api (Cloudflare Browser Rendering API proxy)
    print("\n" + "="*60)
    print("🧪 TEST 3: /json-extract-api - Cloudflare Browser Rendering API")
    print("="*60)
    
    json_extract_payload = {
        "url": config["url"],
        "prompt": config["prompt"],
        "waitForSelector": config.get("waitForSelector"),
        "requestId": session_id
        # Note: schema and response_format will be auto-generated
    }
    
    response, duration = post_with_timing("/json-extract-api", json_extract_payload)
    results["json-extract-api"] = {
        "success": response is not None and response.status_code == 200,
        "duration": duration,
        "status_code": response.status_code if response else None,
        "request_id": response.json().get("request_id") if response and response.status_code == 200 else None,
        "inferred_schema": response.json().get("inferredSchema") if response and response.status_code == 200 else None
    }
    
    # Test 4: /observations/patterns (GET)
    print("\n" + "="*60)
    print("🧪 TEST 4: /observations/patterns - Pattern Aggregates")
    print("="*60)
    
    print("📡 GET /observations/patterns")
    start_time = time.time()
    try:
        url = urljoin(BASE + "/", "observations/patterns")
        response = requests.get(url, timeout=30)
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"✅ Status: {response.status_code}")
        print(f"⏱️  Duration: {duration:.2f} seconds")
        
        if response.status_code == 200:
            data = response.json()
            patterns = data.get("patterns", [])
            print(f"📊 Found {len(patterns)} patterns")
            if patterns:
                print(f"📄 Top pattern: {patterns[0].get('pattern', 'N/A')} ({patterns[0].get('success_rate', 0)}% success)")
        
        results["observations/patterns"] = {
            "success": response.status_code == 200,
            "duration": duration,
            "status_code": response.status_code,
            "pattern_count": len(data.get("patterns", [])) if response.status_code == 200 else 0
        }
        
    except Exception as e:
        end_time = time.time()
        duration = end_time - start_time
        print(f"❌ Error: {str(e)}")
        results["observations/patterns"] = {
            "success": False,
            "duration": duration,
            "status_code": None,
            "error": str(e)
        }
    
    # Test 5: /observations (GET with pattern filter)
    print("\n" + "="*60)
    print("🧪 TEST 5: /observations - Pattern Details")
    print("="*60)
    
    print("📡 GET /observations?limit=5")
    start_time = time.time()
    try:
        url = urljoin(BASE + "/", "observations?limit=5")
        response = requests.get(url, timeout=30)
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"✅ Status: {response.status_code}")
        print(f"⏱️  Duration: {duration:.2f} seconds")
        
        if response.status_code == 200:
            data = response.json()
            observations = data.get("observations", [])
            print(f"📊 Found {len(observations)} recent observations")
            if observations:
                print(f"📄 Latest observation: {observations[0].get('action_type', 'N/A')} - {observations[0].get('outcome', 'N/A')}")
        
        results["observations"] = {
            "success": response.status_code == 200,
            "duration": duration,
            "status_code": response.status_code,
            "observation_count": len(data.get("observations", [])) if response.status_code == 200 else 0
        }
        
    except Exception as e:
        end_time = time.time()
        duration = end_time - start_time
        print(f"❌ Error: {str(e)}")
        results["observations"] = {
            "success": False,
            "duration": duration,
            "status_code": None,
            "error": str(e)
        }
    
    return results


def print_comparison_results(results: Dict[str, Dict[str, Any]]):
    """Print a comparison table of all test results."""
    print("\n" + "="*80)
    print("📊 COMPARISON RESULTS")
    print("="*80)
    
    # Create table header
    print(f"{'Endpoint':<25} {'Status':<8} {'Duration':<12} {'Details':<30}")
    print("-" * 80)
    
    # Sort by duration (fastest first)
    sorted_results = sorted(results.items(), key=lambda x: x[1].get('duration', 999))
    
    for endpoint, result in sorted_results:
        if result.get('skipped', False):
            status = "⏭️ SKIP"
            duration = "0.00s"
        else:
            status = "✅ PASS" if result.get('success', False) else "❌ FAIL"
            duration = f"{result.get('duration', 0):.2f}s"
        
        # Additional details based on endpoint
        details = ""
        if endpoint == "stagehand":
            if result.get('skipped', False):
                details = "Skipped as requested"
            else:
                request_id = result.get('request_id')
                details = f"Request ID: {request_id[:8] + '...' if request_id else 'N/A'}"
        elif endpoint == "judge":
            request_id = result.get('request_id')
            details = f"Request ID: {request_id[:8] + '...' if request_id else 'N/A'}"
        elif endpoint == "json-extract-api":
            details = f"Schema: {'Auto' if result.get('inferred_schema') else 'Manual'}"
        elif endpoint == "observations/patterns":
            details = f"Patterns: {result.get('pattern_count', 0)}"
        elif endpoint == "observations":
            details = f"Observations: {result.get('observation_count', 0)}"
        
        print(f"{endpoint:<25} {status:<8} {duration:<12} {details:<30}")
    
    # Summary statistics
    print("\n" + "-" * 80)
    successful_tests = sum(1 for r in results.values() if r.get('success', False))
    total_tests = len(results)
    avg_duration = sum(r.get('duration', 0) for r in results.values()) / total_tests
    
    print(f"📈 Summary: {successful_tests}/{total_tests} tests passed")
    print(f"⏱️  Average duration: {avg_duration:.2f} seconds")
    print(f"🏆 Fastest endpoint: {sorted_results[0][0]} ({sorted_results[0][1].get('duration', 0):.2f}s)")
    print(f"🐌 Slowest endpoint: {sorted_results[-1][0]} ({sorted_results[-1][1].get('duration', 0):.2f}s)")


def main():
    print("🧪 Stagehand Scraper API Test Suite")
    print("=" * 50)
    
    config = {}
    
    # --- New Profile Selection Logic ---
    while True:
        print("\n🔧 Select Job Page Profile:")
        # Display menu options from the profiles
        for key, profile in JOB_PAGE_PROFILES.items():
            print(f"   {key}: {profile['name']} ({profile['url'][:60]}...)")
        
        # Add "Other" and "Quit" options
        other_option_key = str(len(JOB_PAGE_PROFILES) + 1)
        print(f"   {other_option_key}: Other (Enter manually)")
        print("   q: Quit")
        
        choice = input(f"   Enter choice (1-{other_option_key}, q): ").strip().lower()
        
        if choice in JOB_PAGE_PROFILES:
            # User selected a predefined profile
            config = JOB_PAGE_PROFILES[choice].copy()
            print(f"\n✅ Using profile: {config['name']}")
            break
        elif choice == other_option_key:
            # User selected "Other"
            print("\n🔧 Custom Configuration:")
            # Use Cloudflare (profile "1") as the default for prompts
            default_profile = JOB_PAGE_PROFILES["1"] 
            config = {}
            config["url"] = get_user_input("   URL", default_profile["url"])
            config["prompt"] = get_user_input("   Prompt", default_profile["prompt"])
            config["waitForSelector"] = get_user_input("   Wait Selector (optional)", default_profile["waitForSelector"])
            break
        elif choice == 'q':
            # User selected "Quit"
            print("👋 Test cancelled by user.")
            return None
        else:
            # Invalid input
            print(f"❌ Invalid choice. Please enter a number (1-{other_option_key}) or 'q'.")
    # --- End of New Logic ---
    
    # Remove empty waitForSelector if it exists and is empty
    if not config.get("waitForSelector"):
        config.pop("waitForSelector", None)
    
    # Display the final configuration that will be used
    print(f"\n✅ Final Configuration:")
    print(f"   URL: {config['url']}")
    print(f"   Prompt: {config['prompt'][:100]}...")
    if "waitForSelector" in config:
        print(f"   Wait Selector: {config['waitForSelector']}")
    
    # Final confirmation before running the tests
    proceed = input("\n🚀 Ready to test? Press Enter to continue or 'q' to quit: ").strip().lower()
    if proceed == 'q':
        print("👋 Test cancelled by user.")
        return None
    
    print(f"\n🎯 Testing against: {BASE}")
    print("⏳ Starting comprehensive endpoint testing...")
    
    # Run all tests
    results = test_endpoints(config)
    
    # Print comparison results
    print_comparison_results(results)
    
    print(f"\n🎉 Testing complete! Check the results above.")
    print(f"💡 Tip: Visit {BASE} to see the live logs UI with patterns sidebar.")
    
    return results


if __name__ == "__main__":
    final_results = main()
    
    # Check if main returned results (i.e., wasn't cancelled)
    if final_results:
        print("\n" + "="*80)
        print("📦 FINAL RAW RESULTS (JSON)")
        print("="*80)
        # Print the dictionary returned by main() as formatted JSON
        print(json.dumps(final_results, indent=2, default=str))