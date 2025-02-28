from flask import Flask, request, jsonify
from flask_cors import CORS
from bs4 import BeautifulSoup
import requests
import re
import logging
import time
from urllib.parse import urljoin
import html2text

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

DOCUMENTATION = {
    'segment': {
        'base_url': 'https://segment.com/docs/',
        'sections': {
            'sources': 'connections/sources/',
            'destinations': 'connections/destinations/',
            'tracking': 'connections/sources/catalog/',
            'api': 'api/',
            'privacy': 'privacy/'
        },
        'content_selectors': [
            'article', 'main', '.documentation-content', '.docs-content', '.markdown-body'
        ],
        'exclude_selectors': [
            'nav', 'header', 'footer', '.sidebar', '.navigation', '.toc'
        ]
    },
    'mparticle': {
        'base_url': 'https://docs.mparticle.com/',
        'sections': {
            'profiles': 'guides/guides/user-profiles/',
            'events': 'developers/events/',
            'identity': 'guides/identity/',
            'audiences': 'guides/platform-guide/audiences/',
            'sdk': 'developers/sdk/'
        },
        'content_selectors': [
            'article', 'main', '.content', '.documentation-body', '.docs-content'
        ],
        'exclude_selectors': [
            'nav', 'header', 'footer', '.sidebar', '.navigation', '.toc'
        ]
    },
    'lytics': {
        'base_url': 'https://docs.lytics.com/',
        'sections': {
            'apis': 'developer/apis/',
            'integrations': 'integrations/',
            'audiences': 'user-guides/audiences/',
            'campaigns': 'user-guides/campaigns/',
            'security': 'admin/security/'
        },
        'content_selectors': [
            'article', 'main', '.docs-content', '.content-wrapper', '.markdown-section'
        ],
        'exclude_selectors': [
            'nav', 'header', 'footer', '.sidebar', '.navigation', '.toc'
        ]
    },
    'zeotap': {
        'base_url': 'https://docs.zeotap.com/home/en-us/',
        'sections': {
            'data': 'data-management/',
            'identities': 'identity-management/',
            'audiences': 'audience-management/',
            'insights': 'analytics-and-insights/',
            'integrations': 'integrations/'
        },
        'content_selectors': [
            'article', 'main', '.markdown-content', '.docs-content', '.content-body'
        ],
        'exclude_selectors': [
            'nav', 'header', 'footer', '.sidebar', '.navigation', '.toc'
        ]
    }
}

# Format text for better display
def format_for_display(text):
    # Add structure to raw documentation text
    formatted = []
    lines = text.split('\n')
    
    current_section = None
    step_counter = 1
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Detect section headers
        if line.endswith(':'):
            formatted.append(f"\n{line.upper()}")
            current_section = line
        # Detect steps
        elif line.startswith(('1.', '-', '*')):
            formatted.append(f"{step_counter}. {line[2:].strip()}")
            step_counter += 1
        # Detect code blocks
        elif '`' in line:
            formatted.append(f"Code example: `{line}`")
        # Detect important notes
        elif line.lower().startswith('note:'):
            formatted.append(f"Note: {line[5:]}")
        else:
            formatted.append(line)
    
    return '\n\n'.join(formatted[:45])  # Limit to 45 lines

# Expanded keyword patterns for better section matching
def find_relevant_section(question):
    question = question.lower()
    patterns = {
        'segment': {
            'sources': r'\b(source|sources|setup|create|implement|install|integration|integrate|sdk|library|connector)\b',
            'destinations': r'\b(destination|destinations|connect|integration|send data|export|forward|warehouse)\b',
            'tracking': r'\b(track|tracking|event|events|analytics|identify|page|screen|group|alias)\b',
            'api': r'\b(api|endpoint|request|authentication|token|key|curl|http|post|get)\b',
            'privacy': r'\b(privacy|gdpr|ccpa|consent|opt-out|regulation|compliance|pii|personal data)\b'
        },
        'mparticle': {
            'profiles': r'\b(profile|profiles|user|customer|attribute|property|traits)\b',
            'events': r'\b(event|events|track|tracking|custom event|commerce|transaction|revenue)\b',
            'identity': r'\b(identity|id|identification|customer id|device id|email|mpid|login|logout)\b',
            'audiences': r'\b(audience|segment|segmentation|targeting|cohort|filter)\b',
            'sdk': r'\b(sdk|library|implementation|mobile|web|installation|setup|configure|init)\b'
        },
        'lytics': {
            'apis': r'\b(api|endpoint|request|authentication|token|key|curl|http|post|get)\b',
            'integrations': r'\b(integration|connect|connector|source|destination|setup|implement)\b',
            'audiences': r'\b(audience|segment|segmentation|targeting|cohort|filter)\b',
            'campaigns': r'\b(campaign|journey|flow|message|trigger|activation|personalization)\b',
            'security': r'\b(security|privacy|compliance|access|permission|role|user|admin)\b'
        },
        'zeotap': {
            'data': r'\b(data|collection|source|import|upload|dataset|schema|field)\b',
            'identities': r'\b(identity|id|identification|resolution|graph|match|merge|customer)\b',
            'audiences': r'\b(audience|segment|segmentation|targeting|cohort|filter|criteria)\b',
            'insights': r'\b(insight|analytics|report|dashboard|metric|measure|visualization)\b',
            'integrations': r'\b(integration|connect|connector|partner|destination|activation)\b'
        }
    }
    
    # First, check if the platform is explicitly mentioned
    for platform in DOCUMENTATION.keys():
        if platform in question:
            max_score = 0
            best_section = None
            
            for section, regex in patterns.get(platform, {}).items():
                matches = re.findall(regex, question)
                score = len(matches)
                if score > max_score:
                    max_score = score
                    best_section = section
            
            if best_section:
                return (platform, best_section)
    
    # If no platform explicitly mentioned, try to infer from terminology
    platform_scores = {}
    for platform, pattern_dict in patterns.items():
        score = 0
        for section, regex in pattern_dict.items():
            matches = re.findall(regex, question)
            score += len(matches)
        platform_scores[platform] = score
    
    # Get platform with highest score if any
    if platform_scores:
        best_platform = max(platform_scores.items(), key=lambda x: x[1])
        if best_platform[1] > 0:
            platform = best_platform[0]
            
            # Find best section match
            max_score = 0
            best_section = None
            for section, regex in patterns[platform].items():
                matches = re.findall(regex, question)
                score = len(matches)
                if score > max_score:
                    max_score = score
                    best_section = section
            
            if best_section:
                return (platform, best_section)
            
            # If we determined platform but not section, return first section
            if platform:
                return (platform, list(DOCUMENTATION[platform]['sections'].keys())[0])
    
    return (None, None)

def extract_text_from_html(html_content, exclude_selectors=None):
    """Convert HTML to readable text while preserving structure"""
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = True
    h.body_width = 0  # Don't wrap text
    
    return h.handle(html_content)

def scrape_documentation(platform, section, max_retries=3, retry_delay=2):
    """Scrape documentation with retry mechanism and better content extraction"""
    base_url = DOCUMENTATION[platform]['base_url']
    section_path = DOCUMENTATION[platform]['sections'][section]
    url = urljoin(base_url, section_path)
    
    logger.info(f"Scraping documentation for {platform} - {section} from {url}")
    
    content_selectors = DOCUMENTATION[platform]['content_selectors']
    exclude_selectors = DOCUMENTATION[platform]['exclude_selectors']
    
    retries = 0
    while retries < max_retries:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
                'Accept-Language': 'en-US,en;q=0.9',
            }
            
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove unwanted elements
            for selector in exclude_selectors:
                for element in soup.select(selector):
                    element.decompose()
            
            # Try each content selector until we find content
            content = None
            for selector in content_selectors:
                if selector.startswith('.'):
                    content_element = soup.find(class_=selector[1:])
                else:
                    content_element = soup.find(selector)
                
                if content_element and content_element.get_text(strip=True):
                    content = content_element
                    break
            
            # If no specific selector worked, use the whole body
            if not content:
                content = soup.find('body') or soup
            
            # Extract and format text
            extracted_text = extract_text_from_html(str(content))
            
            # Clean up the text: remove excessive newlines and spaces
            cleaned_text = re.sub(r'\n{3,}', '\n\n', extracted_text)
            cleaned_text = re.sub(r' {2,}', ' ', cleaned_text)
            
            # Format the text for better display
            formatted_text = format_for_display(cleaned_text)
            
            return formatted_text
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error: {str(e)}")
            retries += 1
            if retries < max_retries:
                logger.info(f"Retrying in {retry_delay} seconds... (Attempt {retries+1}/{max_retries})")
                time.sleep(retry_delay)
            else:
                logger.error(f"Failed to retrieve documentation after {max_retries} attempts")
                return None
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            return None

def search_documentation(platform, keywords, max_results=3):
    """Search across multiple documentation sections for relevant content"""
    results = []
    
    for section_name, section_path in DOCUMENTATION[platform]['sections'].items():
        content = scrape_documentation(platform, section_name)
        if not content:
            continue
            
        relevance_score = 0
        for keyword in keywords:
            # Count occurrences of keyword in the content
            keyword_count = len(re.findall(r'\b' + re.escape(keyword) + r'\b', content.lower()))
            relevance_score += keyword_count
            
        if relevance_score > 0:
            results.append({
                'section': section_name,
                'score': relevance_score,
                'content': content
            })
    
    # Sort by relevance score and return top results
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:max_results]

@app.route('/ask', methods=['POST'])
def ask():
    try:
        data = request.json
        question = data.get('question', '')
        
        if not question:
            return jsonify({
                'answer': 'Please ask a question about CDP platforms like Segment, mParticle, Lytics, or Zeotap.',
                'status': 'error',
                'error': 'No question provided'
            })

        # Extract keywords for more comprehensive searching
        keywords = re.findall(r'\b\w{3,}\b', question.lower())
        keywords = [k for k in keywords if k not in ['how', 'what', 'when', 'where', 'why', 'the', 'and', 'for', 'with']]
        
        platform, section = find_relevant_section(question)
        
        if not platform:
            return jsonify({
                'answer': 'I currently support questions about Segment, mParticle, Lytics, and Zeotap. Try asking about sources, destinations, events, user profiles, audiences, APIs, or integrations!',
                'status': 'info',
                'platforms': list(DOCUMENTATION.keys())
            })

        if section:
            # Primary approach: Get documentation from the specific section
            answer = scrape_documentation(platform, section)
            if answer:
                return jsonify({
                    'answer': f"From {platform.capitalize()} documentation on {section}:\n\n{answer}",
                    'status': 'success',
                    'platform': platform,
                    'section': section
                })
        
        # Fallback approach: Search across all sections
        logger.info(f"Searching across all {platform} documentation for keywords: {keywords}")
        search_results = search_documentation(platform, keywords)
        
        if search_results:
            # Combine the top results
            combined_answer = f"Here's what I found in {platform.capitalize()} documentation:\n\n"
            for i, result in enumerate(search_results):
                combined_answer += f"--- {result['section'].upper()} ---\n{result['content'][:300]}...\n\n"
            
            return jsonify({
                'answer': combined_answer,
                'status': 'success',
                'platform': platform,
                'sections': [r['section'] for r in search_results]
            })
        
        return jsonify({
            'answer': f"I couldn't find specific information about '{question}' in the {platform} documentation. Please try rephrasing your question or check the official documentation directly.",
            'status': 'not_found',
            'platform': platform
        })

    except Exception as e:
        logger.exception(f"Server error: {str(e)}")
        return jsonify({
            'answer': 'An error occurred while processing your request. Our engineering team has been notified. Please try again later!',
            'status': 'error',
            'error': str(e)
        })

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'version': '1.2.0',
        'supported_platforms': list(DOCUMENTATION.keys())
    })

if __name__ == '__main__':
    logger.info("Starting CDP Documentation API server")
    app.run(debug=True, port=5000)