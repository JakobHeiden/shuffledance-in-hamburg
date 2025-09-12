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
  if (!SD.exists("SIGNUP.TXT")) {
    File signupsFile = SD.open("SIGNUP.TXT", FILE_WRITE);
    signupsFile.close();
    Serial.println(F("Created empty SIGNUP.TXT"));
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

  // Wait for request to arrive
  unsigned long timeoutAt = millis() + 3000;  // 3 second timeout
  while (client.connected() && !client.available() && millis() < timeoutAt) {
    delay(1);
  }

  if (!client.available()) {
    Serial.println(F("No data received from client!"));
    client.stop();
    Serial.println(F("=== CLIENT DISCONNECTED (TIMEOUT) ==="));
    return;
  }

  // Read the first line of the request
  String requestLine = client.readStringUntil('\n');
  // Extract HTTP method (GET, POST, etc.)
  String method = requestLine.substring(0, requestLine.indexOf(' '));
  Serial.print(F("Method: "));
  Serial.println(method);

  Serial.print(F("Request: "));
  Serial.println(requestLine);

  if (method == F("POST")) {
    Serial.println(F("Handling POST request"));

    // Skip headers until we find the empty line
    String line;
    do {
      line = client.readStringUntil('\n');
      line.trim();
    } while (line.length() > 0);

    // Read POST body (form data)
    String postData = client.readString();
    Serial.print(F("POST data: "));
    Serial.println(postData);

    // Parse name from postData (format: "name=encoded_value")
    String name = "";
    if (postData.startsWith("name=")) {
      name = postData.substring(5); // Skip "name="
      name = urlDecode(name);
      Serial.print(F("Decoded name: "));
      Serial.println(name);
    }

    if (name.length() == 0) {
      // Empty name - send error
      client.println(F("ERROR: Empty name"));
      return;
    }

    // Try to open signups file for writing (append mode)
    File signupsFile = SD.open("SIGNUP.TXT", FILE_WRITE);
    if (!signupsFile) {
      Serial.println(F("Failed to open signups file!"));
      client.println(F("ERROR: File access failed"));
      return;
    }

    // Write the name to file (one per line)
    signupsFile.println(name);
    signupsFile.close();

    Serial.print(F("Saved signup: "));
    Serial.println(name);

    // Success response
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Content-Type: text/plain"));
    client.println(F("Connection: close"));
    client.println();
    client.println(F("SUCCESS"));

    // TODO: Check for duplicates
  } else {
    // Handle GET requests (serve files)
    String filePath = getRequestedFile(requestLine);
    Serial.print(F("Requested file: "));
    Serial.println(filePath);

    // Ignore the rest of the request headers
    while (client.available()) {
      client.readStringUntil('\n');
    }

    serveFile(client, filePath);
  }

  client.stop();
  Serial.println(F("=== CLIENT DISCONNECTED ==="));
}

String getRequestedFile(String requestLine) {
  // HTTP request looks like: "GET /style.css HTTP/1.1"
  int startPos = requestLine.indexOf(' ') + 1;
  int endPos = requestLine.indexOf(' ', startPos);

  String path = requestLine.substring(startPos, endPos);

  // If they request "/", serve "index.html"
  if (path == F("/")) {
    path = F("/INDEX.HTM");
  }

  if (path == F("/signup")) {
    path = F("/SIGNUP.TXT");
  }

  // Remove the leading slash for SD card
  if (path.startsWith("/")) {
    path = path.substring(1);
  }

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
  client.println();  // Empty line required!

  // Send file contents
  while (file.available()) {
    client.write(file.read());
  }

  file.close();
  Serial.println(F("File served successfully"));
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

String urlDecode(String input) {
  String output = "";
  for (int i = 0; i < input.length(); i++) {
    if (input[i] == '%' && i + 2 < input.length()) {
      // Convert hex to character
      String hex = input.substring(i + 1, i + 3);
      char c = (char)strtol(hex.c_str(), NULL, 16);
      output += c;
      i += 2; // Skip the hex digits
    } else if (input[i] == '+') {
      output += ' '; // + becomes space
    } else {
      output += input[i];
    }
  }
  return output;
}