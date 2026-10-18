"""
Simple RAG (retrieval-augmented generation) search on TF-IDF.

For a hackathon prototype this is enough, and it needs no external
embeddings API: it works entirely locally. It can easily be replaced
with a vector database (Pinecone/Chroma/pgvector) without changing the
retrieve() interface.
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.data.documents import get_documents_for_role


class RoleAwareRetriever:
    def __init__(self):
        # A separate index per role is what implements the access
        # separation: an agent physically cannot see another role's documents.
        self._vectorizers = {}
        self._matrices = {}
        self._docs = {}
        # guest is intentionally absent: an unauthenticated user has no
        # internal documents. This is not a prompt-level ban but the
        # physical absence of data.
        for role in ("student", "teacher", "admin"):
            self.reindex(role)

    def reindex(self, role: str):
        """Rebuilds the role's index. Called at startup and after a new
        document is uploaded to the library."""
        docs = get_documents_for_role(role)
        texts = [f"{d['title']}. {d['content']}" for d in docs]
        vectorizer = TfidfVectorizer()
        matrix = vectorizer.fit_transform(texts) if texts else None
        self._vectorizers[role] = vectorizer
        self._matrices[role] = matrix
        self._docs[role] = docs

    def retrieve(self, role: str, query: str, top_k: int = 3):
        docs = self._docs.get(role, [])
        matrix = self._matrices.get(role)
        vectorizer = self._vectorizers.get(role)
        if not docs or matrix is None:
            return []

        query_vec = vectorizer.transform([query])
        scores = cosine_similarity(query_vec, matrix)[0]
        ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)

        # The threshold drops documents unrelated to the query, so the
        # agent does not pull random noise into its context.
        results = [(doc, score) for doc, score in ranked if score > 0.05]
        return results[:top_k]


retriever = RoleAwareRetriever()
