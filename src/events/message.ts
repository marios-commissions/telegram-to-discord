import type { Chat, Reply, Listener } from '@typings/structs';
import type { NewMessageEvent } from 'telegram/events';

import { NewMessage } from 'telegram/events';
import mimeTypes from 'mime-types';
import { Api } from 'telegram';
import path from 'path';
import fs from 'fs';

import { Webhook, Client } from '@structures';
import { uuid, codeblock } from '@utilities';
import { Paths } from '@constants';
import config from '@config';

Client.addEventHandler(onMessage, new NewMessage());

async function onMessage({ message }: NewMessageEvent & { chat: Chat; }) {
  if (!config.messages.commands && message.message.startsWith('/')) return;

  const author = await message.getSender() as Api.User;
  const chat = await message.getChat() as Chat;

  if (!author?.username || ~config.messages.blacklist.indexOf(author.username)) return;

  const chatId = chat.id.toString();

  Client._log.info(`New message from ${chatId}:${author.username}:${author.id}`);

  const listeners = config.listeners.filter(l => l.group === chatId);
  if (!listeners.length) return;

  if (chat.forum) {
    const reply = await message.getReplyMessage() as Reply;

    for (const listener of listeners.filter(l => l.forum) as Listener[]) {
      if (listener.group !== chatId) continue;

      onForumMessage({ message, chat, author, reply, listener });
    }
  } else {
    for (const listener of listeners.filter(l => !l.forum) as Listener[]) {
      if (listener.group !== chatId) continue;

      onGroupMessage({ message, chat, author, listener });
    }
  }
}

interface HandlerArguments {
  listener: Listener;
  message: Api.Message;
  author: Api.User;
  chat: Chat;
}

async function onForumMessage({ message, author, reply, listener, chat }: HandlerArguments & { reply: Reply; }) {
  const isTopic = reply?.replyTo?.forumTopic ?? false;
  const topicId = reply?.replyTo?.replyToTopId ?? reply?.replyTo?.replyToMsgId;

  const [topic] = (isTopic ? await Client.getMessages(chat.id, { ids: [topicId] }) : [reply]) as Reply[];

  const channel = listener.channels?.find((payload) => {
    if (payload.name === topic?.action?.title) {
      return true;
    }

    if (payload.main && !topic?.action?.title) {
      return true;
    }

    return false;
  });

  if (listener.channels?.length && !channel) return;

  const user = listener.users?.find(user => user === author.username);
  if (listener.users?.length && !user) return;

  const files = await getFiles(message);

  if (!message.message && !files.length) return;

  const hasReply = reply?.id !== topic?.id;
  const replyAuthor = hasReply && await reply?.getSender?.() as Api.User;

  Webhook.send(channel?.webhook ?? listener.webhook, {
    username: listener.name,
    content: [
      replyAuthor && `> \`${replyAuthor.firstName + ':'}\` ${reply.message}`,
      `${codeblock(author.firstName + ':')} ${message.message}`
    ].filter(Boolean).join('\n')
  }, files);
}


async function onGroupMessage({ message, author, listener }: HandlerArguments) {
  const user = listener.users?.find(user => user === author.username);
  if (listener.users?.length && !user) return;

  const files = await getFiles(message);

  if (!message.message && !files.length) return;

  const reply = await message.getReplyMessage() as Reply;
  const replyAuthor = await reply?.getSender() as Api.User;

  Webhook.send(listener.webhook, {
    username: listener.name,
    content: [
      replyAuthor && `> \`${replyAuthor.firstName}:\` ${reply.message}`,
      `${codeblock(author.firstName + ':')} ${message.message}`
    ].filter(Boolean).join('\n')
  }, files);
};

async function getFiles(message: Api.Message) {
  const files = [];

  if (!fs.existsSync(Paths.Files)) {
    fs.mkdirSync(Paths.Files);
  }

  const media = message.media as Api.MessageMediaPhoto;
  const document = message.media as Api.MessageMediaDocument;
  const photo = media?.photo;

  if (message.document?.fileReference || media || photo) {
    const payload = photo ?? document?.document ?? message.document as any;
    if (!payload) return files;

    Client._log.info(`Received media payload with mime type ${payload.mimeType}`);
    if (config.messages.attachments.ignore.includes(payload.mimeType)) {
      return files;
    }

    const media = await message.downloadMedia() as Buffer;
    const file = path.join(Paths.Files, uuid(30));

    fs.writeFileSync(file, media);

    const attribute = payload.attributes?.find(a => a.fileName);

    const name = attribute?.fileName ?? [
      path.basename(file),
      '.',
      mimeTypes.extension(payload.mimeType ?? 'image/png')
    ].join('');

    files.push({ path: file, name, mimeType: payload.mimeType ?? 'image/png' });
  }

  return files;
}
