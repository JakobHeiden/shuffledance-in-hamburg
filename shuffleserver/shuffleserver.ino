#include <Ethernet.h>
#include <SD.h>
#include <avr/wdt.h>

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
EthernetServer server(80);
unsigned long lastHealthCheck = 0;

void setup() {
  Serial.begin(9600);
  Serial.println(F("\n\n\n========================================"));
  Serial.println(F("      ARDUINO WEB SERVER RESTART"));
  Serial.println(F("========================================"));
  displayFreeram();

  // Initialize SD card first
  Serial.print(F("Initializing SD card..."));
  if (!SD.begin(4)) {
    Serial.println(F("SD card initialization failed!"));
    while (1)
      ;
  }
  Serial.println(F("SD card ready"));
  if (!SD.exists(F("INDEX.HTM"))) {
    Serial.println(F("INDEX.HTM not found!"));
    listFiles();
    while (1)
      ;
  }

  // Start Ethernet
  if (Ethernet.begin(mac) == 0) {
    Serial.println(F("Failed to configure Ethernet using DHCP"));
    while (1)
      ;
  }

  server.begin();
  Serial.print(F("Server started at: "));
  Serial.println(Ethernet.localIP());
  Serial.print(F("\n"));

  wdt_enable(WDTO_8S);
}

void loop() {
  wdt_reset();

  if (millis() > lastHealthCheck + 16000) {
    if (!checkEthernetHealth()) {
      while (1);
    }
    lastHealthCheck = millis();
  }
  
  EthernetClient client = server.available();
  if (!client) {
    return;
  }

  Serial.println(F("=== NEW CLIENT ==="));
  displayFreeram();
  unsigned long timeoutAt = millis() + 3000;
  while (client.connected() && !client.available() && millis() < timeoutAt) {
    delay(1);
  }

  if (!client.available()) {
    Serial.println(F("No data received from client!"));
    client.stop();
    Serial.println(F("=== CLIENT DISCONNECTED (TIMEOUT) ==="));
    return;
  }

  String requestLine = readLineSafely(client);
  String method = requestLine.substring(0, requestLine.indexOf(' '));
  Serial.print(F("Request: "));
  Serial.println(requestLine);

  if (method == F("POST")) {
    handlePOST(client);
  } else {
    handleGET(client, requestLine);
  }
  client.stop();
  Serial.println(F("=== CLIENT DISCONNECTED ==="));
}

void handlePOST(EthernetClient& client) {
  skipHeaders(client);

  String postData = readStringSafely(client);
  Serial.print(F("POST data: "));
  Serial.println(postData);
  int firstAmpersand = postData.indexOf('&');
  String name = urlDecode(postData.substring(5, firstAmpersand));                  // cut off "name="
  String status = postData.substring(firstAmpersand + 8, postData.length() - 16);  // cut off "&status=" and "&sunday=YYYYMMDD"
  String sunday = postData.substring(postData.length() - 8);                       // sunday is YYYYMMDD
  Serial.print(F("Decoded postData: "));
  Serial.print(name);
  Serial.print(F(","));
  Serial.print(status);
  Serial.print(F(","));
  Serial.println(sunday);

  if (!isValidDate(sunday)) {
    handleError(F("invalid date"));
    return;
  }
  File signupsFile = SD.open(sunday + ".TXT", FILE_WRITE);
  if (!signupsFile) {
    handleError(F("Failed to open signups file"));
    return;
  }
  
  signupsFile.print(name);
  signupsFile.print(F(","));
  signupsFile.println(status);
  signupsFile.close();

  Serial.print(F("Saved signup: "));
  Serial.print(name);
  Serial.print(F(","));
  Serial.print(status);
  Serial.print(F(" to "));
  Serial.println(signupsFile.name());

  client.println(F("HTTP/1.1 200 OK"));
  client.println(F("Content-Type: text/plain"));
  client.println(F("Connection: close"));
  client.println();
  client.println(F("SUCCESS"));
}

void handleGET(EthernetClient& client, const String& requestLine) {
  String filePath = filePathOf(requestLine);
  Serial.print(F("Requested file: "));
  Serial.println(filePath);

  while (client.available()) {
    readLineSafely(client);
  }

  serveFile(client, filePath);
}

void skipHeaders(EthernetClient& client) {
    while (client.available()) {
        char c = client.read();
        if (c == '\n') {
            if (client.peek() == '\r') client.read();
            if (client.peek() == '\n') {
                client.read();
                break;
            }
        }
    }
}

String readLineSafely(EthernetClient& client) {
    char buffer[200];
    int i = 0;
  
    while (client.available() && i < 199) {
        char c = client.read();
        if (c == '\n') break;
        buffer[i++] = c;
    }
    buffer[i] = '\0';
    
    if (i == 199) {
        Serial.println(F("Line too long, truncated"));
    }
    
    return String(buffer);
}

String readStringSafely(EthernetClient& client) {
    char buffer[200];
    int i = 0;
    
    while (client.available() && i < 199) {
        buffer[i++] = client.read();
    }
    buffer[i] = '\0';
  
    if (i == 199) {
      Serial.println(F("String too long, truncated"));
    }

    return String(buffer);
}

bool isValidDate(const String& date) {
    if (date.length() != 8) {
        return false;
    }
    
    for (int i = 0; i < 8; i++) {
        if (!isDigit(date[i])) {
            return false;
        }
    }
    
    return true;
}

String filePathOf(String requestLine) {
  int URIstart = requestLine.indexOf(' ') + 1;
  int URIend = requestLine.indexOf(' ', URIstart);
  int ampersand = requestLine.indexOf('?');
  String path = "";
  String sunday = "";
  if (ampersand == -1) {
    path = requestLine.substring(URIstart, URIend);
    sunday = F("00000000");
  } else {
    path = requestLine.substring(URIstart, ampersand);
    sunday = requestLine.substring(ampersand + 8, URIend);
  }

  if (path == F("/")) {
    path = F("/INDEX.HTM");
  }

  if (path == F("/signup")) {
    path = "/" + sunday + F(".TXT");
  }

  // Remove the leading slash for SD card
  if (path.startsWith("/")) {
    path = path.substring(1);
  }

  Serial.print(F("path: "));
  Serial.println(path);
  return path;
}

void serveFile(EthernetClient& client, String filename) {
  Serial.print(F("Attempting to open: "));
  Serial.println(filename);

  File file = SD.open(filename);

  // Guard clause: handle file not found early
  if (!file) {
    Serial.print(F("File not found: "));
    Serial.println(filename);
    if (filename.endsWith(F(".TXT"))) {
      Serial.println(F("serving empty file"));
      client.println(F("HTTP/1.1 200 OK"));
      client.println(F("Content-Type: text/plain"));
      client.println(F("Connection: close"));
      client.println();
      return;
    }
    client.println(F("HTTP/1.1 404 Not Found"));
    client.println(F("Content-Type: text/html"));
    client.println(F("Connection: close"));
    client.println();
    client.println(F("<h1>404 - File Not Found</h1>"));
    client.print(F("<p>The file '"));
    client.print(filename);
    client.println(F("' was not found on the server.</p>"));
    return;
  }

  // Happy path: file exists, serve it
  Serial.println(F("File found! Serving..."));

  // Send HTTP headers
  client.println(F("HTTP/1.1 200 OK"));

  // Set content type based on file extension
  if (filename.endsWith(F(".HTM"))) {
    client.println(F("Content-Type: text/html"));
  } else if (filename.endsWith(F(".CSS"))) {
    client.println(F("Content-Type: text/css"));
  } else {
    client.println(F("Content-Type: text/plain"));
  }

  client.println(F("Connection: close"));
  client.println();

  // Send file contents
  while (file.available()) {
    client.write(file.read());
  }

  file.close();
  Serial.println(F("File served successfully"));
}

bool checkEthernetHealth() {
    EthernetClient testClient;
    if (testClient.connect(IPAddress(192, 168, 178, 1), 80)) {
        testClient.stop();
        return true;
    }
    return false;
}

String urlDecode(String input) {
  String output = "";
  for (int i = 0; i < input.length(); i++) {
    if (input[i] == '%' && i + 2 < input.length()) {
      // Convert hex to character
      String hex = input.substring(i + 1, i + 3);
      char c = (char)strtol(hex.c_str(), NULL, 16);
      output += c;
      i += 2;  // Skip the hex digits
    } else if (input[i] == '+') {
      output += ' ';  // + becomes space
    } else {
      output += input[i];
    }
  }
  return output;
}

void listFiles() {
  File root = SD.open("/");
  while (true) {
    File entry = root.openNextFile();
    if (!entry) break;

    Serial.print("Found file: '");
    Serial.print(entry.name());
    Serial.print("' size: ");
    Serial.println(entry.size());
    entry.close();
  }
  root.close();
}

void displayFreeram() {
  extern int __heap_start, *__brkval;
  int v;
  int freeRam = (int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval);
  Serial.print(F("- SRAM left: "));
  Serial.println(freeRam);
}

void handleError(const EthernetClient& client, const __FlashStringHelper* message) {
  handleError(message);
  client.print(F("Error: "));
  client.println(message);
}

void handleError(const __FlashStringHelper* message) {
  Serial.print(F("Error: "));
  Serial.println(message);
}
