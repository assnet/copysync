### 📖 About
Welcome to our open source community, ChatPrime! Our goal is to create robust systems and functionalities involving WhatsApp Web. With our technology, we have already developed several applications that enable any type of interaction, whether for automation, customer service, media sending, natural language processing (NLP), and much more.

### Key Features:
📲 Send and Receive Messages (Text, Image, Audio, Video)
👥 Manage Groups and Contacts
🤖 Automation and Creation of Smart Bots
🎯 NLP Integration (Natural Language Processing)
🔗 Easy Integration with Other Systems
📂 Mass File Sending and Downloading
📡 Real-time Notifications
🚀 Maintained Projects
🔹 WPPConnect Server

ChatPrime Server is our backend interface that connects external applications to WhatsApp Web. It’s a stable and scalable solution, perfect for high-performance automation.


### Documentação da biblioteca Baileys: https://baileys.wiki/docs/intro/

### Matar sessao oculta
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Write-Host "Matando PID $_"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }