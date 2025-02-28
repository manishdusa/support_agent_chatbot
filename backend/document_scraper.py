import requests
from bs4 import BeautifulSoup

class DocumentScraper:
    def __init__(self):
        # Base URLs for the documentation of each CDP
        self.base_urls = {
            'segment': 'https://segment.com/docs/',
            'mparticle': 'https://docs.mparticle.com/',
            'lytics': 'https://docs.lytics.com/',
            'zeotap': 'https://docs.zeotap.com/home/en-us/'
        }

    def fetch_documentation(self, platform):
        """
        Fetches the documentation for a given platform.
        
        Args:
            platform (str): The platform to fetch documentation for (e.g., 'segment').
        
        Returns:
            str: The text content of the documentation, or None if an error occurs.
        """
        url = self.base_urls.get(platform)
        if not url:
            print(f"No URL found for platform: {platform}")
            return None

        # Headers to mimic a real browser request
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
        }

        try:
            # Send a GET request to the documentation URL
            response = requests.get(url, headers=headers)
            response.raise_for_status()  # Raise an error for bad status codes (4xx or 5xx)

            # Parse the HTML content using BeautifulSoup
            # Use 'html.parser' as a fallback if 'lxml' is not available
            try:
                soup = BeautifulSoup(response.text, 'lxml')
            except Exception:
                soup = BeautifulSoup(response.text, 'html.parser')

            # Extract the text content from the HTML
            content = soup.get_text(separator=' ')
            return content

        except requests.exceptions.RequestException as e:
            # Handle any errors that occur during the request
            print(f"Error fetching {platform} documentation: {e}")
            return None