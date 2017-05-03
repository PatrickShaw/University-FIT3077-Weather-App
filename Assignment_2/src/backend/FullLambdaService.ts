import * as chalk from 'chalk';

import { LocationMonitoringManager } from '../monitor/LocationMonitoringManager';
import { MonitorMetadata } from '../model/MonitorMetadata';
import { RequestError } from '../model/RequestError';
import { RequestResponse } from '../model/RequestResponse';
import { SessionMonitoringManager } from '../monitor/SessionMonitoringManager';
import { WeatherClient } from '../weather_client/WeatherClient';
import { WeatherClientFactory } from '../weather_client/WeatherClientFactory';
import { WeatherLocationData } from '../model/WeatherLocationData';
import SocketKeys from '../socket.io/socket-keys';

// TODO: Consider if having soft dependencies on Temp & Rainfall & their request data types is better
// allows for dependency injection where you pass in req parameters.

// 300000 milliseconds = 5 mins.
const defaultWeatherPollingInterval: number = 5000;
class MonitoringManagerData {
  public readonly sessionManager: SessionMonitoringManager;
  public readonly addMonitorEventName: string;
  public readonly removeMonitorEventName: string;
  constructor(
    sessionManager: SessionMonitoringManager,
    addMonitorEventName: string,
    removeMonitorEventName: string
  ) {
    this.sessionManager = sessionManager;
    this.addMonitorEventName = addMonitorEventName;
    this.removeMonitorEventName = removeMonitorEventName;
  }
}
/**
 * Controller class instantiated by the node server.
 */
class FullLambdaService {
  private readonly weatherClientFactory: WeatherClientFactory<WeatherClient>;
  // A array to help with some of the duplicate code that the rainfall and temperature managers share
  private readonly monitoringDataList: MonitoringManagerData[];
  private readonly rainfallMonitoringData: MonitoringManagerData;
  private readonly temperatureMonitoringData: MonitoringManagerData;  
  
  // It's convention to call SocketIO.Server io.
  private readonly io: SocketIO.Server;
  // Contains all locations retrieved from weather client
  private melbourneWeatherLocations: string[];
  // Specifies whether we have successfully made a connection to the weather client
  private successfulClientSetup: boolean;
  // Our client that we retrieve weather data from
  private weatherClient: WeatherClient;

  constructor(
    io: SocketIO.Server, 
    weatherClientFactory: WeatherClientFactory<WeatherClient>
  ) {
    this.successfulClientSetup = false;
    this.melbourneWeatherLocations = [];
    this.io = io;
    this.weatherClientFactory = weatherClientFactory;
    this.rainfallMonitoringData = new MonitoringManagerData(
      new SessionMonitoringManager(),
      SocketKeys.addRainfallMonitor,
      SocketKeys.removeRainfallMonitor
    );
    this.temperatureMonitoringData = new MonitoringManagerData(
      new SessionMonitoringManager(),
      SocketKeys.addTemperatureMonitor,
      SocketKeys.removeTemperatureMonitor
    );
    this.monitoringDataList = [
      this.rainfallMonitoringData,
      this.temperatureMonitoringData
    ];
  }
  
  /**
   * Setup websocket endpoints using SocketIO.
   */
  private initialiseSocketEndpoints(): void {
    this.io.sockets.on('connection', (socket: SocketIO.Socket): void => {  
      // Called when session started with frontend.
      const sessionId: string = socket.id;
      console.log(`Session started ${sessionId}`);
      socket.emit(SocketKeys.retrievedLocations, this.melbourneWeatherLocations);
      // Add MonitoringManagerData to manage session with front end client.
      for (const monitoringManager of this.monitoringDataList) {
        monitoringManager.sessionManager.addMonitoringSession(sessionId, new LocationMonitoringManager());
        this.initialiseMonitorSocketEvent(
          socket,
          monitoringManager.addMonitorEventName,
          monitoringManager.removeMonitorEventName,
          monitoringManager.sessionManager
        );
      }

      socket.on('disconnect', () => {
        console.log(`Session ended: ${sessionId}`);
        for (const monitoringManager of this.monitoringDataList) {
          monitoringManager.sessionManager.removeMonitoringSession(sessionId);
        }
      });

      // Emit to front end whether the SOAP Client was successfully created.
      socket.emit(SocketKeys.successfulServerSetup, this.successfulClientSetup);
    });
  }

  private initialiseMonitorSocketEvent(
    socket: SocketIO.Socket,
    addEventName: string, 
    removeEventName: string,
    sessionManager: SessionMonitoringManager
  ) {
    const sessionId = socket.id;
    socket.on(addEventName, (monitor: MonitorMetadata) => {
      try {
        // Frontend sessions wants to monitor another location.
        // monitor is a string that is a location.
        const locationMonitoringManager: LocationMonitoringManager | undefined = 
          sessionManager.getLocationMonitorManagerForSession(sessionId);
        if (locationMonitoringManager) {
          console.log(`Session ID ${chalk.magenta(sessionId)} added monitor ${chalk.magenta(monitor.location)}`);
          // Can add monitor.
          // Add new location to monitor to all locations that are monitored.
          locationMonitoringManager.addMonitorLocation(monitor);
          const rainfallLocationManager: LocationMonitoringManager 
            = this.rainfallMonitoringData.sessionManager.getLocationMonitorManagerForSession(sessionId);
          const temperatureLocationMonitor: LocationMonitoringManager 
            = this.temperatureMonitoringData.sessionManager.getLocationMonitorManagerForSession(sessionId);
          this.weatherClient.retrieveWeatherLocationData(
            monitor.location,
            rainfallLocationManager.getMonitoredLocations().has(monitor.location), 
            temperatureLocationMonitor.getMonitoredLocations().has(monitor.location),
            false
          ).then((weatherLocationData) => {
            socket.emit(addEventName, new RequestResponse(weatherLocationData, null));
          }).catch((error) => {
            console.error(chalk.red(error.message));
            console.error(chalk.red(error.stack));
          });
        } else {
          // Can't add monitor.
          console.error(`${chalk.red('Could add monitor. No session for ID: ')}${chalk.magenta(sessionId)}`);
          const requestError = new RequestError(`Could add monitor ${monitor}.`, `No session for ID: ' ${sessionId}`);
          const response = new RequestResponse(null, requestError);
          socket.emit(addEventName, response);
        }
      } catch (error) {
        const requestError = new RequestError(`Failed to add monitor for location ${monitor}`, error.message);
        const response = new RequestResponse(null, requestError);
        console.error(chalk.red(error.message));
        console.error(chalk.red(error.stack));
        socket.emit(addEventName, response);
      }
    });
    
    socket.on(removeEventName, (monitor: MonitorMetadata) => {
      // monitor is a string that is a location.
      // Frontend emitted remove_monitor with MonitorMetadata.
      try {
        // Note: | means can be type_a or type_b where type_a | type_b.
        const locationMonitoringManager: LocationMonitoringManager | undefined = 
        sessionManager.getLocationMonitorManagerForSession(sessionId);
        if (locationMonitoringManager) {
          console.log(
            `Session ID ${chalk.magenta(sessionId)} ` +
            `removed ${chalk.magenta(removeEventName)} monitor ${chalk.magenta(monitor.location)}`
          );
          // Can remove location.
          locationMonitoringManager.removeMonitoredLocation(monitor);
          socket.emit(removeEventName, new RequestResponse(monitor, null));
        } else {
          // Can't remove location.
          console.error(`${chalk.red('Could remove monitor. No session for ID: ')}${chalk.magenta(sessionId)}`);
          const requestError = new RequestError(
            `Could remove monitor ${monitor}.`,
            `No session for ID: ' ${sessionId}`
          );
          const response = new RequestResponse(null, requestError);
          socket.emit(removeEventName, response);
        }
      } catch (error) {
        const requestError = new RequestError(
          `Failed to remove monitor for location ${monitor}`, 
          error.message
        );
        const response = new RequestResponse(null, requestError);
        console.error(chalk.red(error.message));
        console.error(chalk.red(error.stack));
        socket.emit(removeEventName, response);
      }
    });
  }

  private onAllLocationsRetrieved(locations: string[]) {
    // Retrieves all locations from SOAP client points.
    // Only called once, under the assumption locations are set.
    this.melbourneWeatherLocations = locations;
    this.melbourneWeatherLocations.sort();
    // Send locations to front end.
    this.io.sockets.emit(SocketKeys.retrievedLocations, locations);
    console.log(chalk.cyan(`locations: ${locations}`));
    // setInterval() is a JavaScript method that runs the method every msInterval milliseconds.
    // Note: setInterval() doesn't get data at time 0.
    this.retrieveAllMonitoredWeatherData();
    setInterval(
      (): void => { this.retrieveAllMonitoredWeatherData(); },
      defaultWeatherPollingInterval 
    );  
  }

  private onWeatherLocationDataRetrieved(weatherLocationDataList: WeatherLocationData[]) {
    // Logs timestamp and weatherLocationDataList in backend before sending data to frontend.
    // Send updated data to front end.
    const retrievedDataTimeStamp: string = new Date().toString();
    console.log(
      chalk.green('Retrieved') +
      chalk.magenta(` ${weatherLocationDataList.length} `) +
      chalk.green('weather data items at time:') +
      chalk.magenta(` ${retrievedDataTimeStamp} `)
    );
    // Note: sockets.sockets is a Socket IO library attribute.
    for (const sessionId of Object.keys(this.io.sockets.sockets)) {
      try {
        console.info(`Getting monitoring session for session ID: ${chalk.magenta(sessionId)}`);
        let validSessionMonitors: boolean = true;
        for (const monitoringSession of this.monitoringDataList) {
          const sessionManager: SessionMonitoringManager = monitoringSession.sessionManager;
          if (!sessionManager) {
            validSessionMonitors = false;
            break;
          }
        }
        if (!validSessionMonitors) {
          console.error(
            chalk.red(`Socket ${chalk.magenta(sessionId)} had no monitoring session. Skipping emit.`)
          ); 
          continue; 
        }
        let hasDataToEmit: boolean = false;
        for (const monitoringSession of this.monitoringDataList) {
          if (monitoringSession.sessionManager.getMonitoredLocations().size > 1) {
            hasDataToEmit = true;
            break;
          }
        }
        if (!hasDataToEmit) {
          console.log(`Session ID ${chalk.magenta(sessionId)} wasn't monitoring anything, skipping emission.`);
          continue;
        }
        const rainfallToEmitWeatherFor: Set<string> 
          = this.rainfallMonitoringData.sessionManager.getMonitoredLocations();
        const temperatureToEmitWeatherFor: Set<string> 
          = this.temperatureMonitoringData.sessionManager.getMonitoredLocations();
        // We only need to emit data if the user is monitoring a location.
        // Otherwise don't even bother executing the emission code.
        const weatherDataToEmit: WeatherLocationData[] = [];
        for (const weatherData of weatherLocationDataList) {
          const emitRainfall: boolean = rainfallToEmitWeatherFor.has(weatherData.location);
          const emitTemperature: boolean = temperatureToEmitWeatherFor.has(weatherData.location);
          if (emitTemperature && emitRainfall) {
            weatherDataToEmit.push(weatherData);
          } else if (emitRainfall) {
            weatherDataToEmit.push(new WeatherLocationData(
              weatherData.location,
              weatherData.rainfallData,
              null
            ));
          } else if (emitTemperature) {
            weatherDataToEmit.push(new WeatherLocationData(
              weatherData.location,
              null,
              weatherData.temperatureData
            ));
          }
          const socket = this.io.sockets.sockets[sessionId];
          socket.emit(SocketKeys.replaceWeatherData, weatherDataToEmit);
        }
      } catch (error) {
        console.error(chalk.bgRed(error.message));
        console.error(chalk.red(error.stack));
      }
    }
  }

  private getAllMonitoredLocations(): Set<string> {
    const unionedMonitoredLocations: Set<string> = new Set<string>();
    for (const monitoringManager of this.monitoringDataList) {
      for (const location of monitoringManager.sessionManager.getMonitoredLocations()) {
        unionedMonitoredLocations.add(location);
      }
    }
    return unionedMonitoredLocations;
  }

  private getAllMonitoredLocationsList(): string[] {
    const locationsSet: Set<string> = this.getAllMonitoredLocations();
    const locationIterator: IterableIterator<string> = locationsSet.values();
    const locationsList: string[] = [];
    for (let l = 0; l < locationsSet.size; l++) {
      locationsList[l] = locationIterator.next().value;
    }
    return locationsList;
  }

  private retrieveAllMonitoredWeatherData(): void {
    this.weatherClient.retrieveWeatherLocationDataList(this.getAllMonitoredLocationsList())
      .then((weatherLocationDataList) => {
        this.onWeatherLocationDataRetrieved(weatherLocationDataList);
      }).catch((error) => {
        console.error(chalk.red(error));
        console.error(chalk.red(error.stack));
      });
  }

  private onSoapWeatherClientInitialised(weatherClient: WeatherClient): void {
    console.log(chalk.green('SOAP weather client created'));
    this.weatherClient = weatherClient;
    // This lets any consumers of the API know that we reset the server
    this.io.emit(SocketKeys.retrievedLocations, []);
    this.io.emit(SocketKeys.replaceWeatherData, []);
    // Initialise the socket.io events
    this.initialiseSocketEndpoints();
    // When SOAP Client is resolved which returns melbourneWeatherClient from an async call.
    this.successfulClientSetup = true;
    this.io.emit(SocketKeys.successfulServerSetup, this.successfulClientSetup);
    // Get locations from SOAP client in melbourneWeatherClient.
    weatherClient.retrieveLocations().then((locations: string[]) => {
      this.onAllLocationsRetrieved(locations);
    });
  }

  /**
   * Runs main loop for the full lambda service via setInterval.
   */
  public run(): void {
    // Make MelbourneWeatherClient that has a SOAP Client.
    this.weatherClientFactory.createWeatherClient()
      .then((weatherClient: WeatherClient): void => {
        this.onSoapWeatherClientInitialised(weatherClient);
      })
      .catch((error) => {
        console.error(chalk.bgRed('Failed to create SOAP client connection'));
        console.error(chalk.red(error.message));
        console.error(chalk.red(error.stack));
      });
  }
}

export {FullLambdaService};
export default FullLambdaService;
