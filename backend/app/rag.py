"""
Простой RAG (retrieval-augmented generation) поиск на TF-IDF.

Для хакатон-прототипа этого достаточно и не требует внешнего
embeddings API — работает полностью локально. При желании легко
заменить на векторную БД (Pinecone/Chroma/pgvector) без изменения
интерфейса retrieve().
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.data.documents import get_documents_for_role


class RoleAwareRetriever:
    def __init__(self):
        # Отдельный индекс на роль — это же реализует разграничение
        # доступа: агент физически не видит документы чужой роли.
        self._vectorizers = {}
        self._matrices = {}
        self._docs = {}
        # guest намеренно отсутствует: у неавторизованного пользователя
        # нет ни одного внутреннего документа — это не запрет в промпте,
        # а физическое отсутствие данных.
        for role in ("student", "teacher", "admin"):
            self.reindex(role)

    def reindex(self, role: str):
        """Пересобирает индекс роли. Вызывается при старте и после
        загрузки нового документа в библиотеку."""
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

        # Порог отсекает документы, вообще не связанные с запросом,
        # чтобы агент не тянул в контекст случайный шум.
        results = [(doc, score) for doc, score in ranked if score > 0.05]
        return results[:top_k]


retriever = RoleAwareRetriever()
