all: javascript web java

clean:
	rm -rf target node_modules

java: target/minicomp-1.0-SNAPSHOT-jar-with-dependencies.jar

javascript: node_modules target/generated-sources/antlr4

web: target/generated-sources/web

node_modules: package.json package-lock.json
	npm install
	touch node_modules

target/minicomp-1.0-SNAPSHOT-jar-with-dependencies.jar: src/main/antlr4/minicomp/MiniLang.g4 $(wildcard src/main/java/minicomp/*.java)
	mvn package

target/generated-sources/antlr4-js: node_modules src/main/antlr4/minicomp/MiniLang.g4
	rm -rf target/generated-sources/antlr4-js
	npm run antlr4

target/web: target/generated-sources/antlr4-js node_modules $(wildcard src/main/js/*) $(wildcard src/main/web/*)
	rm -rf target/web
	npm run webpack

test: javascript-tests java-tests

javascript-tests: javascript
	cli-testrunner tests/test-wasm-backend.yaml

java-tests: java-llvm-tests java-jvm-tests

java-llvm-tests:
	cli-testrunner tests/test-llvm-backend.yaml

java-jvm-tests:
	cli-testrunner tests/test-jvm-backend.yaml

run-java-jvm: java
	java -jar target/minicomp-1.0-SNAPSHOT-jar-with-dependencies.jar --jvm

run-java-llvm: java
	java -jar target/minicomp-1.0-SNAPSHOT-jar-with-dependencies.jar --llvm

run-javascript: javascript
	node src/main/js/main.js

.PHONY: all clean test javascript web java python javascript-tests java-tests java-llvm-tests java-jvm-tests run-javascript run-java-jvm run-java-llvm
