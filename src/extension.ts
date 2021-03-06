/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License.
*--------------------------------------------------------------------------------------------*/

import * as languageclient from 'vscode-languageclient';
import * as logger from './logger';
import * as path from 'path';
import * as schemacontributor from './schema-contributor';
import * as vscode from 'vscode';
import * as schemaassociationservice from './schema-association-service';
import TelemetryReporter from 'vscode-extension-telemetry';
const fs = require('fs');

const myExtensionId = 'azure-pipelines';
const telemetryVersion = generateVersionString(vscode.extensions.getExtension(`ms-azure-devops.${myExtensionId}`));
const telemetryKey = 'ae672644-d394-497c-8c57-98f6eac32342';

let reporter: TelemetryReporter;

export async function activate(context: vscode.ExtensionContext) {
    logger.log('Extension has been activated!', 'ExtensionActivated');

    logger.log(`Spinning up telemetry client for id ${myExtensionId}, version ${telemetryVersion}`);
    reporter = new TelemetryReporter(myExtensionId, telemetryVersion, telemetryKey);
    context.subscriptions.push(reporter);

    try {
        reporter.sendTelemetryEvent('extension.activate');
    } catch(e) {
        // if something bad happens reporting telemetry, swallow it and move on
        logger.log(e.toString());
    }

    const serverOptions: languageclient.ServerOptions = getServerOptions(context);
    const clientOptions: languageclient.LanguageClientOptions = getClientOptions();
    const client = new languageclient.LanguageClient('azure-pipelines', 'Azure Pipelines Support', serverOptions, clientOptions);

    const schemaAssociationService: schemaassociationservice.ISchemaAssociationService = new schemaassociationservice.SchemaAssociationService(context.extensionPath);

    const disposable = client.start();
    context.subscriptions.push(disposable);

    const initialSchemaAssociations: schemaassociationservice.ISchemaAssociations = schemaAssociationService.getSchemaAssociation();

    await client.onReady().then(() => {
        //logger.log(`${JSON.stringify(initialSchemaAssociations)}`, 'SendInitialSchemaAssociation');
        client.sendNotification(schemaassociationservice.SchemaAssociationNotification.type, initialSchemaAssociations);

        // TODO: Should we get rid of these events and handle other events like Ctrl + Space? See when this event gets fired and send updated schema on that event.
        client.onRequest(schemacontributor.CUSTOM_SCHEMA_REQUEST, (resource: any) => {
            //logger.log('Custom schema request. Resource: ' + JSON.stringify(resource), 'CustomSchemaRequest');

            // TODO: Can this return the location of the new schema file?
            return schemacontributor.schemaContributor.requestCustomSchema(resource); // TODO: Have a single instance for the extension but dont return a global from this namespace.
        });

        // TODO: Can we get rid of this? Never seems to happen.
        client.onRequest(schemacontributor.CUSTOM_CONTENT_REQUEST, (uri: any) => {
            //logger.log('Custom content request.', 'CustomContentRequest');

            return schemacontributor.schemaContributor.requestCustomSchemaContent(uri);
        });
    }).catch((reason) =>{
        logger.log(JSON.stringify(reason), 'ClientOnReadyError');
        reporter.sendTelemetryEvent('extension.languageserver.onReadyError', {'reason': JSON.stringify(reason)});
    });

    // TODO: Can we get rid of this since it's set in package.json?
    vscode.languages.setLanguageConfiguration('azure-pipelines', { wordPattern: /("(?:[^\\\"]*(?:\\.)?)*"?)|[^\s{}\[\],:]+/ });

    return schemacontributor.schemaContributor;
}

function getServerOptions(context: vscode.ExtensionContext): languageclient.ServerOptions {
    const languageServerPath = context.asAbsolutePath(path.join('node_modules', 'azure-pipelines-language-server', 'server.js'));

    return {
        run : { module: languageServerPath, transport: languageclient.TransportKind.ipc },
        debug: { module: languageServerPath, transport: languageclient.TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } }
    };
}

function getClientOptions(): languageclient.LanguageClientOptions {
    return {
        // Register the server for plain text documents
        documentSelector: [
            { language: 'azure-pipelines', scheme: 'file' },
            { language: 'azure-pipelines', scheme: 'untitled' }
        ],
        synchronize: {
            // Synchronize the setting section 'languageServerExample' to the server
            // TODO: Are these what settings we want to pass through to the server? Would be good to see this happening... And see initializeOptions. Maybe remove them?
            configurationSection: ['yaml', 'http.proxy', 'http.proxyStrictSSL'],
            // Notify the server about file changes to '.clientrc files contain in the workspace
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.?(e)y?(a)ml'),
                vscode.workspace.createFileSystemWatcher('**/*.json')
            ]
        },
    };
}

// this method is called when your extension is deactivated
export function deactivate() {
    reporter.dispose();
}

function generateVersionString(extension: vscode.Extension<any>): string {
    // if the extensionPath is a Git repo, this is probably an extension developer
    const isDevMode: boolean = extension ? fs.existsSync(extension.extensionPath + '/.git') : false;
    const baseVersion: string = extension ? extension.packageJSON.version : "0.0.0";

    return isDevMode ? `${baseVersion}-dev` : baseVersion;
}