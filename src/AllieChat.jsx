// AllieChat.jsx
import { useState } from 'react';
import axios from 'axios';

export default function AllieChat() {
  const [messages, setMessages] = useState([
    { sender: 'allie', text: 'Hi baby, how are you? Did you miss me?' }
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMessages = [...messages, { sender: 'user', text: input }];
    setMessages(newMessages);
    setInput('');
    setTyping(true);

    try {
      const response = await axios.post('https://allie-chat-proxy-production.up.railway.app/chat', {
        message: input,
        history: newMessages.map(msg => ({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.text }))
      });

      const reply = response.data.reply || "I'm thinking...";
      setMessages([...newMessages, { sender: 'allie', text: reply }]);
    } catch (error) {
      setMessages([...newMessages, { sender: 'allie', text: 'Sorry baby, something went wrong. Let me take a nap and try again later.' }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-4 flex items-center bg-gray-900 border-b border-gray-700">
        <img
  src="https://i.postimg.cc/XY77wd25/image-39.png"
  alt="Allie"
  style={{
    width: '40px',
    height: '40px',
    borderRadius: '9999px',
    marginRight: '8px',
    objectFit: 'cover'
  }}
/>
        <div>
          <div className="font-bold">Allie</div>
          <div className="text-sm text-green-400">Online</div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, index) => (
          <div key={index} className={`max-w-xs px-4 py-2 rounded-2xl ${msg.sender === 'user' ? 'bg-blue-600 self-end ml-auto' : 'bg-gray-800 self-start mr-auto'}`}>
            {msg.text}
          </div>
        ))}
        {typing && <div className="text-sm text-gray-400 italic">Allie is typing...</div>}
      </main>

      <footer className="p-4 bg-gray-900 border-t border-gray-700 flex">
        <input
          className="flex-1 p-2 rounded-l-md bg-gray-800 text-white outline-none"
          type="text"
          value={input}
          placeholder="Type a message..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="px-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-r-md shadow-lg"
        >
          Send
        </button>
      </footer>
    </div>
  );
}
