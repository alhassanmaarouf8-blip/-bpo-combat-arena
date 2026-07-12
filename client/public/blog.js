function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value || '')
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderMessage(container, className, text) {
  container.replaceChildren();
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  container.appendChild(p);
}

function renderPosts(container, posts) {
  container.replaceChildren();
  for (const post of posts) {
    const article = document.createElement('article');
    const heading = document.createElement('h2');
    heading.textContent = String(post?.title || 'Untitled').slice(0, 160);
    article.appendChild(heading);

    if (post?.date) {
      const date = document.createElement('p');
      date.className = 'date';
      date.textContent = formatDate(post.date);
      article.appendChild(date);
    }

    const paragraphs = String(post?.body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.style.whiteSpace = 'pre-line';
      p.textContent = text.slice(0, 10_000);
      article.appendChild(p);
    }
    container.appendChild(article);
  }
}

const container = document.getElementById('posts');
fetch('/posts.json', { cache: 'no-store', credentials: 'same-origin' })
  .then((response) => {
    if (!response.ok) throw new Error(`posts_${response.status}`);
    return response.json();
  })
  .then((data) => {
    const posts = Array.isArray(data) ? data : data?.posts;
    if (!Array.isArray(posts) || !posts.length) {
      renderMessage(container, 'empty', 'No posts yet — check back soon.');
      return;
    }
    renderPosts(container, posts.slice(0, 100));
  })
  .catch(() => renderMessage(container, 'err', 'Couldn’t load posts right now. Please refresh.'));
