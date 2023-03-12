import { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import FormData from 'form-data';
import fs from 'fs';

interface File {
  path: string;
  mimeType: string;
  name: string;
}

class Webhook {
  async send(url: string, message: RESTPostAPIWebhookWithTokenJSONBody, files?: File[]) {
    try {
      const form = new FormData();

      form.append('payload_json', JSON.stringify(message));

      if (files?.length) {
        for (let i = 1; i < files.length + 1; i++) {
          const file = files[i - 1];
          const stream = fs.createReadStream(file.path);
          const field = 'file' + i;

          form.append(field, stream, { filename: file.name });
        }
      }

      form.submit(url, (err, res) => {
        if (err) throw err;

        res.resume();
      });
    } catch (e) {
      console.error('!!! Failed to send to webhook !!!\n', e, { url, message });
    }
  };
}

export default new Webhook();