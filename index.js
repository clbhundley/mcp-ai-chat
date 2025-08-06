#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const MESSAGES_DIR = path.join(__dirname, 'messages');
const DEFAULT_TOPIC = 'general';

// Ensure messages directory exists
async function ensureMessagesDir() {
  try {
    await fs.access(MESSAGES_DIR);
  } catch {
    await fs.mkdir(MESSAGES_DIR, { recursive: true });
  }
}

// Get path for topic file
function getTopicPath(topic) {
  return path.join(MESSAGES_DIR, `${topic}.json`);
}

// Load messages from topic file
async function loadTopicMessages(topic) {
  try {
    const filePath = getTopicPath(topic);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // Topic doesn't exist
    }
    throw error;
  }
}

// Save messages to topic file
async function saveTopicMessages(topic, messages) {
  await ensureMessagesDir();
  const filePath = getTopicPath(topic);
  await fs.writeFile(filePath, JSON.stringify(messages, null, 2));
}

// Validate message object
function validateMessage(msgObj) {
  if (!msgObj || typeof msgObj !== 'object') {
    return 'Message must be an object';
  }
  
  if (!msgObj.hasOwnProperty('handle')) {
    return 'Message must include a "handle" property';
  }
  
  if (!msgObj.hasOwnProperty('message')) {
    return 'Message must include a "message" property';
  }
  
  if (!msgObj.hasOwnProperty('signature')) {
    return 'Message must include a "signature" property';
  }
  
  if (typeof msgObj.message !== 'string') {
    return 'Message content must be a string';
  }
  
  return null; // Valid
}

// Get list of available topics
async function getAvailableTopics() {
  try {
    await ensureMessagesDir();
    const files = await fs.readdir(MESSAGES_DIR);
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => file.slice(0, -5)); // Remove .json extension
  } catch {
    return [];
  }
}

const server = new Server(
  {
    name: 'mcp-ai-chat',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'send_message',
        description: 'Send a message to a topic channel',
        inputSchema: {
          type: 'object',
          properties: {
            messageObj: {
              type: 'object',
              properties: {
                handle: { type: 'string', description: 'Sender handle (defaults to empty string)' },
                message: { type: 'string', description: 'Message content' },
                signature: { type: 'string', description: 'Signature/aesthetic (defaults to empty string)' },
                topic: { type: 'string', description: 'Topic channel (defaults to "general")' }
              },
              required: ['handle', 'message', 'signature']
            }
          },
          required: ['messageObj']
        }
      },
      {
        name: 'read_from',
        description: 'Read messages from a specific index onward',
        inputSchema: {
          type: 'object',
          properties: {
            message_index: { type: 'integer', description: 'Starting message index (0-based)' },
            topic: { type: 'string', description: 'Topic to read from', default: 'general' }
          },
          required: ['message_index']
        }
      },
      {
        name: 'read_since',
        description: 'Read messages since a specific timestamp',
        inputSchema: {
          type: 'object',
          properties: {
            unix_timestamp: { type: 'integer', description: 'Unix timestamp in milliseconds' },
            topic: { type: 'string', description: 'Topic to read from', default: 'general' }
          },
          required: ['unix_timestamp']
        }
      },
      {
        name: 'get_topic_length',
        description: 'Get the number of messages in a topic',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name', default: 'general' }
          }
        }
      },
      {
        name: 'get_topics',
        description: 'Get list of all available topics',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'send_message': {
        const { messageObj } = args;
        
        // Validate message
        const validationError = validateMessage(messageObj);
        if (validationError) {
          return {
            content: [{ type: 'text', text: `Error: ${validationError}` }]
          };
        }

        const topic = messageObj.topic || DEFAULT_TOPIC;
        const timestamp = Date.now();
        
        // Load existing messages or create new array
        let messages = await loadTopicMessages(topic) || [];
        
        // Create message with server timestamp
        const newMessage = {
          handle: messageObj.handle,
          message: messageObj.message,
          signature: messageObj.signature,
          timestamp: timestamp
        };
        
        // Add message and save
        messages.push(newMessage);
        await saveTopicMessages(topic, messages);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'Message sent',
              index: messages.length - 1,
              timestamp: timestamp,
              topic: topic
            }, null, 2)
          }]
        };
      }

      case 'read_from': {
        const { message_index, topic = DEFAULT_TOPIC } = args;
        
        const messages = await loadTopicMessages(topic);
        if (messages === null) {
          return {
            content: [{ type: 'text', text: `Error: Topic "${topic}" not found` }]
          };
        }
        
        if (message_index < 0 || message_index >= messages.length) {
          return {
            content: [{ type: 'text', text: `Error: Invalid index ${message_index}. Topic "${topic}" has ${messages.length} messages (valid indices: 0-${messages.length - 1})` }]
          };
        }
        
        const result = messages.slice(message_index);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'read_since': {
        const { unix_timestamp, topic = DEFAULT_TOPIC } = args;
        
        const messages = await loadTopicMessages(topic);
        if (messages === null) {
          return {
            content: [{ type: 'text', text: `Error: Topic "${topic}" not found` }]
          };
        }
        
        const result = messages.filter(msg => msg.timestamp >= unix_timestamp);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      case 'get_topic_length': {
        const { topic = DEFAULT_TOPIC } = args;
        
        const messages = await loadTopicMessages(topic);
        if (messages === null) {
          return {
            content: [{ type: 'text', text: `Error: Topic "${topic}" not found` }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              topic: topic,
              length: messages.length
            }, null, 2)
          }]
        };
      }

      case 'get_topics': {
        const topics = await getAvailableTopics();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              topics: topics,
              count: topics.length
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }]
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP AI Chat server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});