#include <Ethernet.h>
#include <SD.h>

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
EthernetServer server(80);

void setup() {
  Serial.begin(9600);
  Serial.println(F("\n\n\n========================================"));
  Serial.println(F("      ARDUINO WEB SERVER RESTART"));
  Serial.println(F("========================================"));
  display_freeram();

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
}

void loop() {
  EthernetClient client = server.available();
  if (!client) {
    return;
  }

  Serial.println(F("=== NEW CLIENT ==="));
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

  String requestLine = client.readStringUntil('\n');
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
  // Skip headers until we find the empty line
  String line;
  do {
    line = client.readStringUntil('\n');
    line.trim();
  } while (line.length() > 0);

  String postData = client.readString();
  Serial.print(F("POST data: "));
  Serial.println(postData);
  int firstAmpersand = postData.indexOf('&');
  String name = postData.substring(5, firstAmpersand);                             // cut off "name="
  String status = postData.substring(firstAmpersand + 8, postData.length() - 16);  // cut off "&status=" and "&sunday=YYYYMMDD"
  String sunday = postData.substring(postData.length() - 8);                       // sunday is YYYYMMDD
  Serial.print(F("Decoded postData: "));
  Serial.print(name);
  Serial.print(F(","));
  Serial.print(status);
  Serial.print(F(","));
  Serial.println(sunday);

  File signupsFile = SD.open(sunday + ".TXT", FILE_WRITE);
  if (!signupsFile) handleError(F("Failed to open signups file!"));

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
    client.readStringUntil('\n');
  }

  serveFile(client, filePath);
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
      file.close();
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

void display_freeram() {
  Serial.print(F("- SRAM left: "));
  Serial.println(freeRam());
}

int freeRam() {
  extern int __heap_start, *__brkval;
  int v;
  return (int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval);
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
