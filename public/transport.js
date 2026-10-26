(() => {
  const endpoint = '/.netlify/functions/game';
  const getJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load room data');
    return data;
  };

  const transport = {
    async action(payload) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not do that');
      return data;
    },
    room(code) {
      return getJson(`${endpoint}?action=room&code=${encodeURIComponent(code)}`);
    },
    rooms() {
      return getJson(`${endpoint}?action=rooms`);
    },
    samples() {
      return getJson(`${endpoint}?action=samples`);
    },
    subscribe(code, onRoom, onStatus) {
      let stopped = false;
      let pending = false;
      const poll = async () => {
        if (stopped || pending) return;
        pending = true;
        try {
          const room = await transport.room(code);
          if (!stopped) { onRoom(room); onStatus?.('Room is live'); }
        } catch {
          if (!stopped) onStatus?.('Reconnecting…');
        } finally { pending = false; }
      };
      poll();
      const timer = setInterval(poll, 1400);
      return () => { stopped = true; clearInterval(timer); };
    }
  };
  window.jigsawFriendsTransport = transport;
})();
