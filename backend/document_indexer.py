from document_scraper import DocumentScraper

class DocumentIndexer:
    def __init__(self):
        self.scraper = DocumentScraper()
        self.docs = self.load_docs()

    def load_docs(self):
        docs = {}
        for platform in ['segment', 'mparticle', 'lytics', 'zeotap']:
            content = self.scraper.fetch_documentation(platform)
            if content:
                docs[platform] = content
        return docs

    def search(self, question):
        # Simple keyword-based search
        for platform, content in self.docs.items():
            if question.lower() in content.lower():
                return {
                    'platform': platform,
                    'answer': content[:500] + "..."  # Return a snippet
                }
        return {'answer': 'Sorry, I could not find an answer to your question.'}