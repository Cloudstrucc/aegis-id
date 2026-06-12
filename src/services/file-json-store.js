const fs = require('node:fs/promises');
const path = require('node:path');

class FileJsonStore {
  constructor(filePath, defaultValue = []) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return Array.isArray(this.defaultValue) ? [...this.defaultValue] : { ...this.defaultValue };
      }
      throw error;
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.filePath);
    return value;
  }

  async append(record) {
    const records = await this.read();
    records.push(record);
    await this.write(records);
    return record;
  }
}

module.exports = FileJsonStore;
