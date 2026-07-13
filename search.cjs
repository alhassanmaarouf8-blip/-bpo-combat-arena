const https = require('https');
const http = require('http');

function searchDDG(query) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'lite.duckduckgo.com',
      path: '/lite/?q=' + encodeURIComponent(query),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // Extract result links and snippets
        const linkMatches = data.match(/<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g) || [];
        const snippetMatches = data.match(/<td class="result-snippet"[^>]*>([^<]*)<\/td>/g) || [];
        console.log('=== Results for: ' + query + ' ===');
        console.log('Links found:', linkMatches.length);
        linkMatches.slice(0, 15).forEach((m, i) => {
          const href = m.match(/href="([^"]*)"/);
          const text = m.match(/>([^<]*)</);
          const url = href ? href[1] : '?';
          const title = text ? text[1] : '?';
          console.log((i+1) + '. ' + title + ' | ' + url);
        });
        resolve(data);
      });
    }).on('error', reject);
  });
}

async function main() {
  const queries = [
    'Egypt German call center BPO jobs Facebook group',
    'German speaking jobs Egypt call center WhatsApp Telegram community',
    'site:facebook.com Egypt German call center jobs group',
    'site:reddit.com Egypt German language call center BPO',
    'learn German for call center interview Egypt community',
    '"German speaker" "call center" Egypt LinkedIn group',
    'تعلم اللغة الألمانية كول سنتر مصر جروب فيسبوك'
  ];
  
  for (const q of queries) {
    try {
      await searchDDG(q);
    } catch(e) {
      console.log('Error searching:', q, e.message);
    }
  }
}

main();
