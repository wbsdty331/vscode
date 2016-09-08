/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import {createWriteStream} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {TPromise} from 'vs/base/common/winjs.base';

export function registerExtensionHostProfilingCommand(apiImpl: typeof vscode) {

	interface ProfileSession {
		name: string;
		stop(dir: string): TPromise<string>;
	}

	const profiler = new class Profiler {

		private _v8profiler: TPromise<any>;

		private _init(): TPromise<any> {
			if (!this._v8profiler) {
				this._v8profiler = new TPromise((resolve, reject) => require(['v8-profiler'], resolve, err => {
					console.error(err);
					reject(err);
				}));
			}
			return this._v8profiler;
		}

		startProfiling(): TPromise<ProfileSession> {
			const name = `extension_host_profiler_${Date.now()}`;
			return this._init().then(profiler => {
				profiler.startProfiling(name);

				return {
					name,
					stop(dir: string) {
						return Profiler._stop(dir, profiler, name);
					}
				};
			});
		}

		private static _stop(dir: string, profiler: any, name: string) {
			const profile = profiler.stopProfiling(name);
			if (!profile) {
				throw new Error(`bad name '${name}'`);
			}

			return new TPromise<string>((resolve, reject) => {
				const filename = join(dir, `${name}.cpuprofile`);
				profile.export().pipe(createWriteStream(filename)).on('finish', function () {
					profile.delete();
					resolve(filename);
				});
			});
		}
	};


	let status = apiImpl.window.createStatusBarItem();
	let profileDir = apiImpl.workspace.rootPath || homedir();

	let _currentSession: ProfileSession;

	function startProfiling(): TPromise<any> {

		if (_currentSession) {
			return;
		}

		return profiler.startProfiling().then(session => {
			_currentSession = session;
			status.color = 'yellow';
			status.text = `$(history) Profiling Extension Host (click to stop)`;
			status.command = '_dev.profileExtensionHostFinish';
			status.show();
		});
	}

	function stopProfiling(): TPromise<any> {
		status.command = undefined;
		status.text = `Saving to '${profileDir}'`;
		return TPromise.timeout(1500).then(() => {
			return _currentSession.stop(profileDir);
		}).then(() => {
			_currentSession = undefined;
			status.hide();
		});
	}

	return apiImpl.Disposable.from(
		apiImpl.commands.registerCommand('_dev.profileExtensionHost', startProfiling),
		apiImpl.commands.registerCommand('_dev.profileExtensionHostFinish', stopProfiling)
	);
}