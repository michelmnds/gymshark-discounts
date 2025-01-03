import {
  Client,
  GatewayIntentBits,
  Events,
  TextChannel,
  EmbedBuilder,
} from "discord.js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import { load } from "cheerio";

dotenv.config();

interface Environment {
  DISCORD_TOKEN: string;
  EMAIL_USER: string;
  EMAIL_PASSWORD: string;
  NOTIFICATION_CHANNEL_ID: string;
}

class GymsharkDiscountsBot {
  private client: Client;
  private emailClient: ImapFlow;
  private notificationChannelId: string;

  constructor(env: Environment) {
    // Configuração do cliente Discord
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Configuração do cliente de email (IMAP)
    this.emailClient = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
    });

    this.notificationChannelId = env.NOTIFICATION_CHANNEL_ID;
  }

  private isGymsharkPromoEmail(from: string, subject: string): boolean {
    const fromLower = from.toLowerCase();
    const subjectLower = subject.toLowerCase();

    return (
      fromLower.includes("gymshark") &&
      (subjectLower.includes("up to") ||
        subjectLower.includes("code") ||
        subjectLower.includes("sale") ||
        subjectLower.includes("off") ||
        subjectLower.includes("black friday") ||
        subjectLower.includes("cyber monday") ||
        subjectLower.includes("outlet"))
    );
  }

  private extractPromotionDetails(content: string): {
    discountAmount?: string;
    validUntil?: string;
    promoCode?: string;
  } {
    const details = {
      discountAmount: undefined as string | undefined,
      validUntil: undefined as string | undefined,
      promoCode: undefined as string | undefined,
    };

    // Procura por padrões comuns de desconto
    const discountRegex = /(\d+%\s*(?:OFF|off))/;
    const discountMatch = content.match(discountRegex);
    if (discountMatch) {
      details.discountAmount = discountMatch[1].split("%")[0] + "%";
    }

    // Procura por códigos promocionais
    const promoCodeRegex = /(?:code|cupom|promocode):\s*([A-Z0-9-_]+)/i;
    const promoMatch = content.match(promoCodeRegex);
    if (promoMatch) {
      details.promoCode = promoMatch[1];
    }

    // Procura por data de validade
    const dateRegex =
      /ends?\s*(?:at\s*)?((?:\d{1,2}\s+[A-Za-z]{3},\s*\d{1,2}(?::\d{2})?\s*[APMapm]{2}\s*GMT)|(?:\d{1,2}(?::\d{2})?\s*[APMapm]{2}\s*GMT,\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3})|(?:\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b\s*,?\s*\d{1,2}(?::\d{2})?\s*[APMapm]{2}\s*GMT))/i;

    const dateMatch = content.match(dateRegex);
    if (dateMatch) {
      details.validUntil = dateMatch[1].toUpperCase();
    }

    return details;
  }

  private async notifyDiscord(emailData: {
    subject: string;
    from: string;
    content: string;
    images: string[];
    details: {
      discountAmount?: string;
      validUntil?: string;
      promoCode?: string;
    };
  }) {
    try {
      const channel = await this.client.channels.fetch(
        this.notificationChannelId
      );
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor("#FFFFFF")
          .setTitle(emailData.subject.split(".")[0])
          .setThumbnail(emailData.images[0])
          .setImage(emailData.images[1])
          .setDescription(
            `💰 Desconto: ***${
              emailData.details.discountAmount || "?"
            }*** \n\n 🎫 Cupom: ***${
              emailData.details.promoCode || "Nenhum"
            }*** \n\n 🗓️ Válido até: ***${
              emailData.details.validUntil || "?"
            }*** \n\n ***[Website →](https://eu.gymshark.com)***`
          )
          .setFooter({
            text: "Vale lembrar que para o horário de Portugal é GMT +1.\nOu seja, 10PM GMT = 11PM WEST",
          });
        await (channel as TextChannel).send({
          content: "@everyone",
          embeds: [embed],
        });
      }
    } catch (error) {
      console.error("Erro ao enviar notificação para o Discord:", error);
    }
  }

  async watchEmails() {
    try {
      await this.emailClient.connect();
      console.log("Monitorando emails da Gymshark...");

      // Monitora a caixa de entrada
      await this.emailClient.mailboxOpen("INBOX");

      await this.checkNewEmails();
    } catch (error) {
      console.error("Erro ao monitorar emails:", error);
    }
  }

  private async checkNewEmails() {
    try {
      await this.emailClient.mailboxOpen("INBOX");
      const searchResults = await this.emailClient.search({
        from: "hello@e.gymshark.com",
        seen: false,
      });

      for (const uid of searchResults) {
        const email = await this.emailClient.download(uid.toString());
        const parsed = await simpleParser(email.content);
        const htmlContent = parsed.html || "";
        const $ = load(htmlContent);
        const imageLinks: string[] = [];
        $("img").each((index, element) => {
          const src = $(element).attr("src");
          if (src) {
            imageLinks.push(src);
          }
        });

        const gymsharkLogo =
          "https://cdn.braze.eu/appboy/communication/assets/image_assets/images/644baf29cb770f0fdf433e08/original.png?1682681641";

        const mainImage = () => {
          if (imageLinks[2] === gymsharkLogo) return imageLinks[3];

          return imageLinks[2];
        };

        if (
          this.isGymsharkPromoEmail(
            parsed.from?.text || "",
            parsed.subject || ""
          )
        ) {
          const details = this.extractPromotionDetails(parsed.text || "");

          await this.notifyDiscord({
            subject: parsed.subject || "Nova Promoção Gymshark",
            from: parsed.from?.text || "Gymshark",
            content: parsed.text || "",
            images: [gymsharkLogo, mainImage()],
            details,
          });

          this.emailClient.messageFlagsAdd(uid.toString(), ["\\Seen"]);
        }
      }
    } catch (error) {
      console.error("Erro ao processar novos emails:", error);
    }
  }

  async start() {
    try {
      this.client.once(Events.ClientReady, () => {
        console.log("Bot Gymshark está online!");
        this.watchEmails().catch(console.error);
      });

      await this.client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
      console.error("Erro ao iniciar o bot:", error);
    }
  }
}

// Inicialização
async function main() {
  const env = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN!,
    EMAIL_USER: process.env.EMAIL_USER!,
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD!,
    NOTIFICATION_CHANNEL_ID: process.env.NOTIFICATION_CHANNEL_ID!,
  };

  if (
    !env.DISCORD_TOKEN ||
    !env.EMAIL_USER ||
    !env.EMAIL_PASSWORD ||
    !env.NOTIFICATION_CHANNEL_ID
  ) {
    throw new Error("Faltam variáveis de ambiente necessárias");
  }

  const bot = new GymsharkDiscountsBot(env);
  await bot.start();
}

main().catch(console.error);
