import { WeatherLocationData } from '../../model/WeatherLocationData';

/**
 * Holds information needed by frontend components to determine what to render.
 * Includes a list of WeatherLocationData so it can be plotted on a graph and booleans for weather to show
 * rainfall and/or temperature.
 * 
 */

class MonitoredLocationInformation {
  public readonly weatherDataList: WeatherLocationData[];
  public readonly monitorRainfall: boolean;
  public readonly monitorTemperature: boolean;
  public readonly monitorGraph: boolean;

  constructor(
    weatherDataList: WeatherLocationData[],
    monitorRainfall: boolean,
    monitorTemperature: boolean,
    monitorGraph: boolean = false
  ) {
    this.weatherDataList = weatherDataList;
    this.monitorRainfall = monitorRainfall;
    this.monitorTemperature = monitorTemperature;
    this.monitorGraph = monitorGraph;
  }
  
}

export {MonitoredLocationInformation};
export default MonitoredLocationInformation;
