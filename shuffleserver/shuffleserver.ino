#include <Ethernet.h>

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
EthernetServer server(80);

void setup() {
  Serial.begin(9600);
  
  // Start Ethernet
  if (Ethernet.begin(mac) == 0) {
    Serial.println("Failed to configure Ethernet using DHCP");
    while(1);
  }
  
  server.begin();
  Serial.print("Server started at: ");
  Serial.println(Ethernet.localIP());
}

void loop() {
  EthernetClient client = server.available();
  
  if (client) {
    Serial.println("=== NEW CLIENT ===");
    
    // Wait for request to arrive
    while (client.connected() && !client.available()) {
      delay(1);
    }
    
    // Read the first line of the request
    String requestLine = client.readStringUntil('\n');
    Serial.println("Request: " + requestLine);
    
    // Ignore the rest of the request
    while (client.available()) {
      client.readStringUntil('\n');
    }
    
    // Send response
    Serial.println("Sending response...");
    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: text/html");
    client.println("Connection: close");
    client.println();  // Empty line required!
    client.println("<h1>Hello from Arduino!</h1>");
    client.println("<p>This is step 1 working!</p>");
    
    client.stop();
    Serial.println("=== CLIENT DISCONNECTED ===");
  }
}